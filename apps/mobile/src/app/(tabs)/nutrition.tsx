import { addDays, summarizeDay, type NutrientValues } from "@stoke/core";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../lib/api";
import { deleteFoodLog, logWater, MEAL_ORDER, moveFoodLog, useDiary } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { formatDayLabel, todayKey } from "../../lib/ids";
import type { FoodLog } from "../../lib/types";
import { mealLabel } from "../../features/food/diet";
import { fmtNum, t, tn } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { ActionSheet } from "../../ui/ActionSheet";
import { MacroBar, ProgressRing } from "../../ui/charts";
import { Badge, Button, Card, Divider, ErrorState, IconButton, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";


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
  const tg = d?.targets;
  // Summaries are computed on-device from the (possibly optimistic) entries with the shared core logic.
  const s = d ? summarizeDay(d.entries.map((e) => ({ id: e.id, meal: e.meal, nutrients: e.nutrients, loggedAt: e.loggedAt })), tg ? { energyKcal: tg.energyKcal, proteinG: tg.proteinG, carbsG: tg.carbsG, fatG: tg.fatG, ...(tg.fiberG != null ? { fiberG: tg.fiberG } : {}) } : { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, [...MEAL_ORDER, ...new Set(d.entries.map((e) => e.meal).filter((m) => !MEAL_ORDER.includes(m)))]) : null;
  const p = (k: string) => s?.progress.find((x) => x.key === k);

  return (
    <Screen
      tabBar
      title={t("Nutrition")}
      right={<IconButton icon="add" label={t("Log food")} onPress={() => router.push({ pathname: "/food/search", params: { day } })} bg="surfaceRaised" />}
      onRefresh={() => void diary.refetch()}
      refreshing={diary.isRefetching}
    >
      <Row justify="space-between">
        <IconButton icon="back" label={t("Previous day")} onPress={() => setDay(addDays(day, -1))} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("Go to today")} onPress={() => setDay(todayKey())}>
          <T variant="headline">{formatDayLabel(day)}</T>
        </Pressable>
        <IconButton icon="chevron" label={t("Next day")} onPress={() => setDay(addDays(day, 1))} />
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
              <ProgressRing value={s.totals.energyKcal.value} target={tg?.energyKcal ?? 0} color={th.c.energy} size={104} stroke={9} label={t("Energy")} center={<View style={{ alignItems: "center" }}><T variant="metric">{fmtNum(Math.round(s.totals.energyKcal.value))}</T><T variant="caption" color="textSecondary">{t("of {target}", { target: tg?.energyKcal != null ? fmtNum(tg.energyKcal) : "–" })}</T></View>} />
              <Stack gap={8} style={{ flex: 1 }}>
                {tg ? (
                  <>
                    <MacroBar label={t("Protein")} consumed={p("proteinG")?.consumed ?? 0} target={tg.proteinG} unit="g" color={th.c.protein} missing={p("proteinG")?.missingEntries} />
                    <Row gap={12}>
                      <MacroBar label={t("Carbs")} consumed={p("carbsG")?.consumed ?? 0} target={tg.carbsG} unit="g" color={th.c.carbs} />
                      <MacroBar label={t("Fat")} consumed={p("fatG")?.consumed ?? 0} target={tg.fatG} unit="g" color={th.c.fat} />
                    </Row>
                  </>
                ) : (
                  <T color="textSecondary">{t("No targets set.")}</T>
                )}
              </Stack>
            </Row>
            {tg?.fiberG ? (
              <T variant="caption" color="textTertiary" style={{ marginTop: 10 }}>
                {(p("fiberG")?.missingEntries ?? 0) > 0 ? t("Fibre {eaten} / {target} g (some foods lack fibre data)", { eaten: Math.round(p("fiberG")?.consumed ?? 0), target: Math.round(tg.fiberG) }) : t("Fibre {eaten} / {target} g", { eaten: Math.round(p("fiberG")?.consumed ?? 0), target: Math.round(tg.fiberG) })} · {tg.basis === "estimated" ? t("targets estimated") : tg.basis === "adapted" ? t("targets adapted to your trend") : t("targets set by you")}
              </T>
            ) : null}
          </Card>

          {s.meals.map((m) => {
            const entries = d.entries.filter((e) => e.meal === m.meal);
            return (
              <View key={m.meal}>
                <SectionHeader title={m.totals.energyKcal.value ? `${mealLabel(m.meal)} · ${Math.round(m.totals.energyKcal.value)} kcal` : mealLabel(m.meal)} action={t("Add")} onAction={() => router.push({ pathname: "/food/search", params: { day, meal: m.meal } })} />
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  {entries.length ? (
                    entries.map((e, i) => (
                      <View key={e.id}>
                        {i ? <Divider /> : null}
                        <ListRow
                          title={e.description}
                          subtitle={[e.note ?? (e.baseAmount ? `${Math.round(e.baseAmount)} ${e.baseUnit}` : null), e.provenance === "ai_estimate" ? t("estimate") : null, e.pending ? t("saving…") : null].filter(Boolean).join(" · ")}
                          right={<T variant="metricS" color="textSecondary">{kcal(e.nutrients) ?? "–"}</T>}
                          onPress={() => setSelected(e)}
                          accessibilityHint={t("Opens actions for this entry")}
                        />
                      </View>
                    ))
                  ) : (
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/food/search", params: { day, meal: m.meal } })} style={{ paddingVertical: 14 }}>
                      <T variant="subhead" color="textTertiary">
                        {t("Nothing logged · tap to add")}
                      </T>
                    </Pressable>
                  )}
                </Card>
              </View>
            );
          })}

          <SectionHeader title={t("Water")} />
          <Card>
            <Row justify="space-between">
              <T variant="headline">
                {fmtNum(d.water.totalMl)}
                <T variant="footnote" color="textTertiary">
                  {d.water.targetMl ? ` / ${fmtNum(d.water.targetMl)} ml` : " ml"}
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
            <Button title={t("Quick add")} icon="edit" kind="secondary" size="sm" onPress={() => router.push({ pathname: "/food/quick-add", params: { day } })} />
            <Button title={t("Custom food")} icon="add" kind="secondary" size="sm" onPress={() => router.push("/food/custom")} />
            <Button title={t("Copy yesterday")} icon="history" kind="secondary" size="sm" onPress={async () => { await api("/v1/diary/copy", { body: { fromDay: addDays(day, -1), toDay: day, loggedAt: new Date().toISOString() } }); void diary.refetch(); }} />
          </Row>

          <Card>
            <Row justify="space-between">
              <Stack gap={2} style={{ flex: 1 }}>
                <T variant="headline">{t("Finished logging this day?")}</T>
                <T variant="footnote" color="textSecondary">
                  {t("Complete days are used to adapt your targets.")}
                </T>
              </Stack>
              {d.status === "complete" ? <Badge label={t("Complete")} tone="accent" /> : <Button title={t("Mark complete")} size="sm" onPress={async () => { await api(`/v1/diary/${day}/status`, { method: "PUT", body: { status: "complete" } }); haptic("success"); void diary.refetch(); }} />}
            </Row>
          </Card>

          {weekly.data ? (
            <Card>
              <T variant="label" color="textTertiary">
                {t("Last 7 days")}
              </T>
              <T variant="subhead" style={{ marginTop: 6 }}>
                {weekly.data.completeDays
                  ? tn(weekly.data.completeDays, "Averaged {kcal} kcal and {protein} g protein over {n} complete day.", "Averaged {kcal} kcal and {protein} g protein over {n} complete days.", { kcal: weekly.data.averagesOverCompleteDays.energyKcal != null ? fmtNum(weekly.data.averagesOverCompleteDays.energyKcal) : "–", protein: weekly.data.averagesOverCompleteDays.proteinG ?? "–" })
                  : tn(weekly.data.daysLogged, "{n} day logged; mark days complete to see averages.", "{n} days logged; mark days complete to see averages.")}
              </T>
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionHeader title={t("Plan & cook")} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        <ListRow icon="recipe" title={t("Recipes")} subtitle={t("Nutrition per serving from matched ingredients")} onPress={() => router.push("/recipes")} />
        <Divider />
        <ListRow icon="calendar" title={t("Meal plan")} subtitle={t("A week built from your recipes and saved meals")} onPress={() => router.push("/plan")} />
        <Divider />
        <ListRow icon="cart" title={t("Pantry")} subtitle={t("Subtracted from grocery lists")} onPress={() => router.push("/plan/pantry")} />
        <Divider />
        <ListRow icon="restaurant" title={t("Restaurant menu")} subtitle={t("Find dishes that fit what's left today")} onPress={() => router.push({ pathname: "/food/menu", params: { day } })} />
      </Card>

      <ActionSheet
        visible={!!selected}
        title={selected?.description}
        onClose={() => setSelected(null)}
        actions={
          selected
            ? [
                ...(selected.foodId ? [{ label: t("Change amount"), icon: "edit" as const, onPress: () => router.push({ pathname: "/food/[id]", params: { id: selected.foodId!, day, meal: selected.meal, entryId: selected.id } }) }] : []),
                ...MEAL_ORDER.filter((m) => m !== selected.meal && selected.foodId).map((m) => ({ label: t("Move to {meal}", { meal: mealLabel(m) }), onPress: () => moveFoodLog(selected, m) })),
                { label: t("Delete"), icon: "trash" as const, destructive: true, onPress: () => { deleteFoodLog(selected); haptic("warning"); } },
              ]
            : []
        }
      />
    </Screen>
  );
}
