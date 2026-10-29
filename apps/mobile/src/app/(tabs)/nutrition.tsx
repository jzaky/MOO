import { addDays, summarizeDay, type NutrientValues } from "@moo/core";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../lib/api";
import { deleteFoodLog, logWater, MEAL_ORDER, moveFoodLog, useDiary } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { formatDayLabel, todayKey } from "../../lib/ids";
import type { FoodLog } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { ActionSheet } from "../../ui/ActionSheet";
import { MacroBar, ProgressRing } from "../../ui/charts";
import { Badge, Button, Card, Divider, ErrorState, IconButton, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const MEAL_LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
const kcal = (n: NutrientValues) => (typeof n.energyKcal === "number" ? Math.round(n.energyKcal) : null);

export default function Nutrition() {
  const th = useTheme();
  const [day, setDay] = useState(todayKey());
  const diary = useDiary(day);
  const [selected, setSelected] = useState<FoodLog | null>(null);
  const weekly = useQuery({
    queryKey: ["nutrition", "week", day],
    queryFn: () => api<{ averagesOverCompleteDays: { energyKcal: number | null; proteinG: number | null }; completeDays: number; daysLogged: number }>("/v1/nutrition/summary", { query: { from: addDays(day, -6), to: day } }),
    staleTime: 5 * 60_000,
  });

  const d = diary.data;
  const t = d?.targets;
  // Summaries are computed on-device from the (possibly optimistic) entries with the shared core logic.
  const s = d ? summarizeDay(d.entries.map((e) => ({ id: e.id, meal: e.meal, nutrients: e.nutrients, loggedAt: e.loggedAt })), t ? { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, ...(t.fiberG != null ? { fiberG: t.fiberG } : {}) } : { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, [...MEAL_ORDER, ...new Set(d.entries.map((e) => e.meal).filter((m) => !MEAL_ORDER.includes(m)))]) : null;
  const p = (k: string) => s?.progress.find((x) => x.key === k);

  return (
    <Screen
      tabBar
      title="Nutrition"
      right={<IconButton icon="add" label="Log food" onPress={() => router.push({ pathname: "/food/search", params: { day } })} bg="surfaceRaised" />}
      onRefresh={() => void diary.refetch()}
      refreshing={diary.isRefetching}
    >
      <Row justify="space-between">
        <IconButton icon="back" label="Previous day" onPress={() => setDay(addDays(day, -1))} />
        <Pressable accessibilityRole="button" accessibilityLabel="Go to today" onPress={() => setDay(todayKey())}>
          <T variant="headline">{formatDayLabel(day)}</T>
        </Pressable>
        <IconButton icon="chevron" label="Next day" onPress={() => setDay(addDays(day, 1))} />
      </Row>

      {diary.isPending && !d ? (
        <Card>
          <Stack>
            <Skeleton height={110} />
            <Skeleton width="70%" />
          </Stack>
        </Card>
      ) : diary.isError && !d ? (
        <Card>
          <ErrorState error={diary.error} onRetry={() => void diary.refetch()} />
        </Card>
      ) : d && s ? (
        <>
          <Card>
            <Row gap={16}>
              <ProgressRing value={s.totals.energyKcal.value} target={t?.energyKcal ?? 0} color={th.c.energy} size={104} stroke={9} label="Energy" center={<View style={{ alignItems: "center" }}><T variant="metric">{Math.round(s.totals.energyKcal.value).toLocaleString()}</T><T variant="caption" color="textSecondary">of {t?.energyKcal?.toLocaleString() ?? "–"}</T></View>} />
              <Stack gap={8} style={{ flex: 1 }}>
                {t ? (
                  <>
                    <MacroBar label="Protein" consumed={p("proteinG")?.consumed ?? 0} target={t.proteinG} unit="g" color={th.c.protein} missing={p("proteinG")?.missingEntries} />
                    <Row gap={12}>
                      <MacroBar label="Carbs" consumed={p("carbsG")?.consumed ?? 0} target={t.carbsG} unit="g" color={th.c.carbs} />
                      <MacroBar label="Fat" consumed={p("fatG")?.consumed ?? 0} target={t.fatG} unit="g" color={th.c.fat} />
                    </Row>
                  </>
                ) : (
                  <T color="textSecondary">No targets set.</T>
                )}
              </Stack>
            </Row>
            {t?.fiberG ? (
              <T variant="caption" color="textTertiary" style={{ marginTop: 10 }}>
                Fibre {Math.round(p("fiberG")?.consumed ?? 0)} / {Math.round(t.fiberG)} g{(p("fiberG")?.missingEntries ?? 0) > 0 ? " (some foods lack fibre data)" : ""} · targets {t.basis === "estimated" ? "estimated" : t.basis === "adapted" ? "adapted to your trend" : "set by you"}
              </T>
            ) : null}
          </Card>

          {s.meals.map((m) => {
            const entries = d.entries.filter((e) => e.meal === m.meal);
            return (
              <View key={m.meal}>
                <SectionHeader title={`${MEAL_LABEL[m.meal] ?? m.meal}${m.totals.energyKcal.value ? ` · ${Math.round(m.totals.energyKcal.value)} kcal` : ""}`} action="Add" onAction={() => router.push({ pathname: "/food/search", params: { day, meal: m.meal } })} />
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  {entries.length ? (
                    entries.map((e, i) => (
                      <View key={e.id}>
                        {i ? <Divider /> : null}
                        <ListRow
                          title={e.description}
                          subtitle={[e.note ?? (e.baseAmount ? `${Math.round(e.baseAmount)} ${e.baseUnit}` : null), e.provenance === "ai_estimate" ? "estimate" : null, e.pending ? "saving…" : null].filter(Boolean).join(" · ")}
                          right={<T variant="metricS" color="textSecondary">{kcal(e.nutrients) ?? "–"}</T>}
                          onPress={() => setSelected(e)}
                          accessibilityHint="Opens actions for this entry"
                        />
                      </View>
                    ))
                  ) : (
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/food/search", params: { day, meal: m.meal } })} style={{ paddingVertical: 14 }}>
                      <T variant="subhead" color="textTertiary">
                        Nothing logged · tap to add
                      </T>
                    </Pressable>
                  )}
                </Card>
              </View>
            );
          })}

          <SectionHeader title="Water" />
          <Card>
            <Row justify="space-between">
              <T variant="headline">
                {d.water.totalMl.toLocaleString()}
                <T variant="footnote" color="textTertiary">
                  {d.water.targetMl ? ` / ${d.water.targetMl.toLocaleString()} ml` : " ml"}
                </T>
              </T>
              <Row gap={6}>
                {[250, 500].map((ml) => (
                  <Button key={ml} title={`+${ml}`} kind="secondary" size="sm" onPress={() => { logWater(day, ml); haptic("light"); }} />
                ))}
              </Row>
            </Row>
          </Card>

          <Row gap={8} wrap>
            <Button title="Quick add" icon="edit" kind="secondary" size="sm" onPress={() => router.push({ pathname: "/food/quick-add", params: { day } })} />
            <Button title="Custom food" icon="add" kind="secondary" size="sm" onPress={() => router.push("/food/custom")} />
            <Button title="Copy yesterday" icon="history" kind="secondary" size="sm" onPress={async () => { await api("/v1/diary/copy", { body: { fromDay: addDays(day, -1), toDay: day, loggedAt: new Date().toISOString() } }); void diary.refetch(); }} />
          </Row>

          <Card>
            <Row justify="space-between">
              <Stack gap={2} style={{ flex: 1 }}>
                <T variant="headline">Finished logging this day?</T>
                <T variant="footnote" color="textSecondary">
                  Complete days are used to adapt your targets.
                </T>
              </Stack>
              {d.status === "complete" ? <Badge label="Complete" tone="accent" /> : <Button title="Mark complete" size="sm" onPress={async () => { await api(`/v1/diary/${day}/status`, { method: "PUT", body: { status: "complete" } }); haptic("success"); void diary.refetch(); }} />}
            </Row>
          </Card>

          {weekly.data ? (
            <Card>
              <T variant="label" color="textTertiary">
                Last 7 days
              </T>
              <T variant="subhead" style={{ marginTop: 6 }}>
                {weekly.data.completeDays
                  ? `Averaged ${weekly.data.averagesOverCompleteDays.energyKcal?.toLocaleString()} kcal and ${weekly.data.averagesOverCompleteDays.proteinG} g protein over ${weekly.data.completeDays} complete day${weekly.data.completeDays > 1 ? "s" : ""}.`
                  : `${weekly.data.daysLogged} day${weekly.data.daysLogged === 1 ? "" : "s"} logged; mark days complete to see averages.`}
              </T>
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionHeader title="Plan & cook" />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        <ListRow icon="recipe" title="Recipes" subtitle="Nutrition per serving from matched ingredients" onPress={() => router.push("/recipes")} />
        <Divider />
        <ListRow icon="calendar" title="Meal plan" subtitle="A week built from your recipes and saved meals" onPress={() => router.push("/plan")} />
        <Divider />
        <ListRow icon="cart" title="Pantry" subtitle="Subtracted from grocery lists" onPress={() => router.push("/plan/pantry")} />
        <Divider />
        <ListRow icon="restaurant" title="Restaurant menu" subtitle="Find dishes that fit what's left today" onPress={() => router.push({ pathname: "/food/menu", params: { day } })} />
      </Card>

      <ActionSheet
        visible={!!selected}
        title={selected?.description}
        onClose={() => setSelected(null)}
        actions={
          selected
            ? [
                ...(selected.foodId ? [{ label: "Change amount", icon: "edit" as const, onPress: () => router.push({ pathname: "/food/[id]", params: { id: selected.foodId!, day, meal: selected.meal, entryId: selected.id } }) }] : []),
                ...MEAL_ORDER.filter((m) => m !== selected.meal && selected.foodId).map((m) => ({ label: `Move to ${MEAL_LABEL[m]}`, onPress: () => moveFoodLog(selected, m) })),
                { label: "Delete", icon: "trash" as const, destructive: true, onPress: () => { deleteFoodLog(selected); haptic("warning"); } },
              ]
            : []
        }
      />
    </Screen>
  );
}
