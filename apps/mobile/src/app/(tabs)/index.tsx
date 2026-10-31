import { displayBodyWeight } from "@stoke/core";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { mealLabel } from "../../features/food/diet";
import { snapshotFromToday } from "../../features/native/widgetSnapshot";
import { updateWidgets } from "../../features/native/widgets";
import { buildTimeline, type TimelineEvent } from "../../features/today/timeline";
import { useActiveWorkout } from "../../features/workout/store";
import { candidateNutrients } from "../../features/command/draft";
import { api } from "../../lib/api";
import { defaultMealForNow, logFood, logWater, qk, useDiary, useRecentFoods, useToday } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { fmtNum, locale, t, tn } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { EmberRing, SegmentMeter } from "../../ui/charts";
import { Badge, Button, Card, ErrorState, fireFill, Icon, IconButton, Row, SectionHeader, Skeleton, Stack, startMargin, startOffset, startPadding, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });

/** The command bar's entry point on Today: looks like an input, opens the full command sheet. */
function CommandBarButton() {
  const th = useTheme();
  return (
    <View style={[fireFill(th, 100), { borderRadius: 19, padding: 1, opacity: 0.95 }]}>
      <Pressable accessibilityRole="search" accessibilityLabel={t("Log, ask or start anything")} onPress={() => router.push("/log")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 50, borderRadius: 18, backgroundColor: pressed ? th.c.surfacePressed : th.c.surface })}>
        <Icon name="bolt" size={16} color="accentGold" />
        <T variant="subhead" color="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
          {t("Log, ask or start anything…")}
        </T>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Speak")} hitSlop={8} onPress={() => router.push("/food/voice")} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: th.c.border }}>
          <Icon name="mic" size={14} color="textSecondary" />
        </Pressable>
      </Pressable>
    </View>
  );
}

function Dot({ tone }: { tone: "done" | "next" | "todo" }) {
  const th = useTheme();
  const c = tone === "done" ? th.c.data : tone === "next" ? th.c.accent : th.c.surfaceRaised;
  return <View style={{ position: "absolute", ...startOffset(-21), top: "50%", marginTop: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: c, borderWidth: 2, borderColor: tone === "todo" ? th.c.border : c }} />;
}

function EventRow({ ev, unit, trend, onStart }: { ev: TimelineEvent; unit: "metric" | "imperial"; trend: string | null; onStart: (id: string) => void }) {
  const th = useTheme();
  const time = (s: string) => (
    <T variant="mono" color="textTertiary" style={{ width: 44 }}>
      {s}
    </T>
  );
  switch (ev.kind) {
    case "now":
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, ...startMargin(-22), marginVertical: 2 }}>
          <View style={{ width: 14, height: 1, backgroundColor: th.c.accent }} />
          <T variant="label" color="accent" style={{ fontSize: 10 }}>
            {t("Now {time}", { time: clock(ev.at) })}
          </T>
          <View style={{ flex: 1, height: 1, backgroundColor: th.c.accentMuted }} />
        </View>
      );
    case "weigh":
      return (
        <Pressable accessibilityRole="button" onPress={() => router.push("/progress")} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 }}>
          <Dot tone="done" />
          {time("·")}
          <T variant="subhead" style={{ flex: 1 }}>
            {t("Weigh-in {w}", { w: `${displayBodyWeight(ev.kg, unit).value} ${displayBodyWeight(0, unit).unit}` })}
          </T>
          {trend ? <T variant="mono" color="textSecondary">{trend}</T> : null}
        </Pressable>
      );
    case "weigh_todo":
      return (
        <Pressable accessibilityRole="button" onPress={() => router.push("/weigh-in")} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 }}>
          <Dot tone="todo" />
          {time("·")}
          <T variant="subhead" color="textSecondary" style={{ flex: 1 }}>
            {t("Weigh in")}
          </T>
          <T variant="monoBold" color="accent">{t("LOG")}</T>
        </Pressable>
      );
    case "meal":
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={t("{meal}: {kcal} kcal", { meal: mealLabel(ev.meal), kcal: ev.kcal })} onPress={() => router.push("/nutrition")} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 }}>
          <Dot tone="done" />
          {time(clock(ev.at))}
          <T variant="subhead" style={{ flex: 1 }} numberOfLines={1}>
            {ev.items.length > 2 ? `${mealLabel(ev.meal)} · ${tn(ev.items.length, "{n} item", "{n} items")}` : ev.items.join(", ")}
          </T>
          <T variant="mono" color={ev.pending ? "textTertiary" : "textSecondary"}>{fmtNum(ev.kcal)}</T>
        </Pressable>
      );
    case "workout_done":
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 }}>
          <Dot tone="done" />
          {time("·")}
          <T variant="subhead" style={{ flex: 1 }}>{ev.name}</T>
          <T variant="mono" color="data">{t("done")}</T>
        </View>
      );
    case "workout_active":
    case "workout_next":
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ev.kind === "workout_active" ? t("Resume {name}", { name: ev.name }) : t("Start {name}", { name: ev.name })}
          onPress={() => (ev.kind === "workout_active" ? router.push("/workout/active") : onStart(ev.id))}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,106,43,0.4)", backgroundColor: pressed ? th.c.surfacePressed : th.c.accentMuted })}
        >
          <Dot tone="next" />
          {time(ev.kind === "workout_active" ? clock(ev.at) : ev.scheduled ? t("today") : t("next"))}
          <Stack gap={1} style={{ flex: 1 }}>
            <T variant="headline" numberOfLines={1}>{ev.name}</T>
            <T variant="caption" color="textSecondary">
              {ev.kind === "workout_active" ? tn(ev.setsDone, "In progress · {n} set done", "In progress · {n} sets done") : t("Tap to see the plan and start")}
            </T>
          </Stack>
          <T variant="monoBold" color="accent">{ev.kind === "workout_active" ? t("RESUME ▸") : t("START ▸")}</T>
        </Pressable>
      );
    case "meal_next":
      return (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/food/search", params: { meal: ev.meal } })} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 30 }}>
          <Dot tone="todo" />
          {time("·")}
          <T variant="subhead" color="textSecondary" style={{ flex: 1 }}>{mealLabel(ev.meal)}</T>
          {ev.kcalLeft != null ? <T variant="mono" color="textTertiary">{t("≈ {n} left", { n: fmtNum(ev.kcalLeft) })}</T> : null}
        </Pressable>
      );
  }
}

export default function Today() {
  const th = useTheme();
  const qc = useQueryClient();
  const today = useToday();
  const active = useActiveWorkout();
  const d = today.data;
  const day = d?.day ?? todayKey();
  const diary = useDiary(day);
  const recents = useRecentFoods();
  const [now, setNow] = useState(() => new Date());
  const [nudged, setNudged] = useState<string | null>(null);
  const activeName = active?.name ?? null;
  // Home-screen widgets (iOS) mirror today's numbers whenever they load or change.
  useEffect(() => {
    if (d) updateWidgets(snapshotFromToday(d, activeName));
  }, [d, activeName]);
  // Keep the "now" marker moving.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const greeting = (() => {
    const h = now.getHours();
    return h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
  })();

  const checkIn = async (fatigue: number) => {
    haptic("selection");
    await api(`/v1/checkins/${day}`, { method: "PUT", body: { fatigue } }).catch(() => {});
    void qc.invalidateQueries({ queryKey: qk.today });
  };

  const n = d?.nutrition;
  const tg = n?.targets;
  // Diary entries include anything logged on this device but not yet synced.
  const entries = diary.data?.entries ?? [];
  const eaten = diary.data ? entries.reduce((a, e) => a + (e.nutrients.energyKcal ?? 0), 0) : (n?.totals.energyKcal ?? 0);
  const sum = (k: "proteinG" | "carbsG" | "fatG") => (diary.data ? entries.reduce((a, e) => a + (e.nutrients[k] ?? 0), 0) : (n?.totals[k] ?? 0));
  const remaining = tg ? Math.round(tg.energyKcal - eaten) : null;
  const unit = d?.profile.unitSystem ?? "metric";
  const rate = d?.weight.rate;
  const trend = rate?.kgPerWeek != null && rate.sufficiency !== "insufficient" ? t("{change} {unit}/wk", { change: `${rate.kgPerWeek >= 0 ? "+" : "−"}${displayBodyWeight(Math.abs(rate.kgPerWeek), unit).value}`, unit: displayBodyWeight(0, unit).unit }) : null;

  const events = d
    ? buildTimeline({
        day,
        now,
        entries,
        weighedTodayKg: d.weight.latest?.day === day ? d.weight.latest.kg : null,
        active: active ? { name: active.name, startedAt: active.startedAt, setsDone: active.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0) } : null,
        workout: d.workout,
        kcalLeft: remaining,
      })
    : [];

  // A habit nudge from your own history: a food you often log at this meal, not yet logged today.
  const meal = defaultMealForNow(now);
  const loggedIds = new Set(entries.map((e) => e.foodId));
  const habit = (recents.data ?? []).find((r) => r.uses >= 3 && r.lastMeal === meal && r.lastPortion && !loggedIds.has(r.food.id));
  const habitKcal = habit ? candidateNutrients({ food: habit.food, portion: habit.lastPortion })?.energyKcal : null;

  return (
    <Screen
      tabBar
      title={d?.profile.displayName ? t("{greeting}, {name}", { greeting, name: d.profile.displayName }) : greeting}
      subtitle={now.toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" })}
      right={
        <>
          <IconButton icon="coach" label={t("Coach")} onPress={() => router.push("/coach")} />
          <IconButton icon="settings" label={t("Settings")} onPress={() => router.push("/settings")} />
        </>
      }
      onRefresh={() => {
        void today.refetch();
        void diary.refetch();
      }}
      refreshing={today.isRefetching}
    >
      <CommandBarButton />

      {today.isPending && !d ? (
        <Card>
          <Row gap={16}>
            <Skeleton height={140} width={140} radius={70} />
            <Stack style={{ flex: 1 }}>
              <Skeleton />
              <Skeleton />
              <Skeleton width="60%" />
            </Stack>
          </Row>
        </Card>
      ) : today.isError && !d ? (
        <Card>
          <ErrorState error={today.error} onRetry={() => void today.refetch()} />
        </Card>
      ) : d ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Open nutrition diary")} onPress={() => router.push("/nutrition")}>
            <Row gap={16} align="center">
              <EmberRing
                value={eaten}
                target={tg?.energyKcal ?? 0}
                label={t("Energy: {eaten} of {target} kcal", { eaten: Math.round(eaten), target: tg?.energyKcal ?? 0 })}
                center={
                  <View style={{ alignItems: "center" }}>
                    <T variant="metricXL" color={remaining != null && remaining < 0 ? "warning" : "text"}>{remaining == null ? "–" : fmtNum(Math.abs(remaining))}</T>
                    <T variant="label" color="textSecondary" style={{ fontSize: 9 }}>
                      {remaining == null ? t("no target") : remaining >= 0 ? t("kcal left") : t("kcal over")}
                    </T>
                  </View>
                }
              />
              <Stack gap={11} style={{ flex: 1 }}>
                {tg ? (
                  <>
                    <SegmentMeter label={t("Protein")} consumed={sum("proteinG")} target={tg.proteinG} unit="g" color={th.c.protein} />
                    <SegmentMeter label={t("Carbs")} consumed={sum("carbsG")} target={tg.carbsG} unit="g" color={th.c.carbs} />
                    <SegmentMeter label={t("Fat")} consumed={sum("fatG")} target={tg.fatG} unit="g" color={th.c.fat} />
                  </>
                ) : (
                  <T color="textSecondary">{t("Set targets in Settings to track progress.")}</T>
                )}
              </Stack>
            </Row>
          </Pressable>

          <Row justify="space-between">
            <Row gap={6}>
              <Icon name="water" size={14} color="water" />
              <T variant="mono" color="textSecondary">
                {n?.water.targetMl ? `${fmtNum(n.water.totalMl ?? 0)} / ${fmtNum(n.water.targetMl)} ml` : `${fmtNum(n?.water.totalMl ?? 0)} ml`}
              </T>
            </Row>
            <Button
              title="+250 ml"
              kind="secondary"
              size="sm"
              icon="water"
              onPress={() => {
                logWater(day, 250);
                haptic("light");
                qc.setQueryData(qk.today, (old: typeof d | undefined) => (old ? { ...old, nutrition: { ...old.nutrition, water: { ...old.nutrition.water, totalMl: old.nutrition.water.totalMl + 250 } } } : old));
              }}
            />
          </Row>

          <Row justify="space-between" style={{ marginTop: 4 }}>
            <T variant="label" color="textTertiary" accessibilityRole="header">{t("Your day")}</T>
            {d.recovery.readiness !== "normal" ? <Badge label={d.recovery.readiness === "good" ? t("Signals normal") : t("Take it easier")} tone={d.recovery.readiness === "poor" ? "warning" : "info"} /> : null}
          </Row>
          <View style={{ ...startPadding(22), gap: 10 }}>
            <View style={{ position: "absolute", ...startOffset(6), top: 8, bottom: 8, width: 2, backgroundColor: th.c.border }} />
            {events.map((ev) => (
              <EventRow key={ev.key} ev={ev} unit={unit} trend={trend} onStart={(id) => router.push({ pathname: "/workout/active", params: { templateId: id } })} />
            ))}
          </View>

          {habit && habitKcal != null && nudged !== habit.food.id ? (
            <Card>
              <Row gap={12}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: th.c.accentMuted }}>
                  <Icon name="flame" size={17} color="accentGold" />
                </View>
                <Stack gap={1} style={{ flex: 1 }}>
                  <T variant="headline" numberOfLines={1}>{t("{food} again?", { food: habit.food.name.split(",")[0]! })}</T>
                  <T variant="caption" color="textSecondary">{tn(habit.uses, "You've logged it once before", "You've logged it {n} times · same amount as last time")}</T>
                </Stack>
                <Button
                  title={`+${fmtNum(Math.round(habitKcal))}`}
                  kind="secondary"
                  size="sm"
                  accessibilityLabel={t("Log {food}, {kcal} kcal", { food: habit.food.name, kcal: Math.round(habitKcal) })}
                  onPress={() => {
                    logFood({ food: habit.food, portion: habit.lastPortion!, day, meal });
                    haptic("success");
                    setNudged(habit.food.id);
                  }}
                />
              </Row>
            </Card>
          ) : null}

          <SectionHeader title={t("How do you feel today?")} />
          <Row gap={6}>
            {[t("Fresh"), t("Good"), t("OK"), t("Tired"), t("Drained")].map((l, i) => (
              <Pressable key={l} accessibilityRole="button" accessibilityLabel={t("Fatigue: {level}", { level: l })} onPress={() => void checkIn(i + 1)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: th.c.border, backgroundColor: pressed ? th.c.surfacePressed : th.c.surface })}>
                <T variant="caption" color="textSecondary">{l}</T>
              </Pressable>
            ))}
          </Row>
          {d.recovery.insights.map((i) => (
            <T key={i.id} variant="footnote" color="textSecondary">{i.message}</T>
          ))}

          {d.insights.length || d.pendingRecommendations.length ? (
            <>
              <SectionHeader title={t("Coach")} action={t("Open")} onAction={() => router.push("/coach")} />
              <Card>
                <Stack gap={10}>
                  {d.insights.map((i) => (
                    <Row key={i.id} gap={10} align="flex-start">
                      <Icon name={i.kind === "suggestion" ? "coach" : i.kind === "calculated" ? "progress" : "info"} size={16} color={i.kind === "suggestion" ? "accent" : "data"} />
                      <T variant="subhead" style={{ flex: 1 }}>{i.text}</T>
                    </Row>
                  ))}
                  {d.pendingRecommendations.map((r) => (
                    <Button key={r.id} title={t("Review: {title}", { title: r.title })} kind="secondary" size="md" onPress={() => router.push("/coach")} />
                  ))}
                </Stack>
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
