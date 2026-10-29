import { displayBodyWeight } from "@stoke/core";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useActiveWorkout } from "../../features/workout/store";
import { api } from "../../lib/api";
import { logWater, qk, useToday } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { useTheme } from "../../theme/theme";
import { MacroBar, ProgressRing } from "../../ui/charts";
import { Badge, Button, Card, ErrorState, Icon, IconButton, Row, SectionHeader, Skeleton, Stack, T, type IconName } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: th.radius.lg, backgroundColor: pressed ? th.c.surfacePressed : th.c.surface, borderWidth: 1, borderColor: th.c.hairline })}>
      <Icon name={icon} size={20} color="accent" />
      <T variant="caption" color="textSecondary">
        {label}
      </T>
    </Pressable>
  );
}

export default function Today() {
  const th = useTheme();
  const qc = useQueryClient();
  const today = useToday();
  const active = useActiveWorkout();
  const d = today.data;
  const day = d?.day ?? todayKey();
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  const checkIn = async (fatigue: number) => {
    haptic("selection");
    await api(`/v1/checkins/${day}`, { method: "PUT", body: { fatigue } }).catch(() => {});
    void qc.invalidateQueries({ queryKey: qk.today });
  };

  const n = d?.nutrition;
  const t = n?.targets;
  const remaining = t ? Math.round(t.energyKcal - (n?.totals.energyKcal ?? 0)) : null;

  return (
    <Screen
      tabBar
      title={greeting + (d?.profile.displayName ? `, ${d.profile.displayName}` : "")}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      right={<IconButton icon="settings" label="Settings" onPress={() => router.push("/settings")} />}
      onRefresh={() => void today.refetch()}
      refreshing={today.isRefetching}
    >
      <Row gap={8}>
        <QuickAction icon="search" label="Log food" onPress={() => router.push("/food/search")} />
        <QuickAction icon="barcode" label="Scan" onPress={() => router.push("/food/scan")} />
        <QuickAction icon="camera" label="Photo" onPress={() => router.push("/food/camera")} />
        <QuickAction icon="mic" label="Voice" onPress={() => router.push("/food/voice")} />
      </Row>

      {today.isPending && !d ? (
        <Card>
          <Stack>
            <Skeleton height={132} width={132} radius={66} />
            <Skeleton />
            <Skeleton width="60%" />
          </Stack>
        </Card>
      ) : today.isError && !d ? (
        <Card>
          <ErrorState error={today.error} onRetry={() => void today.refetch()} />
        </Card>
      ) : d ? (
        <>
          <Card onPress={() => router.push("/nutrition")} accessibilityLabel="Open nutrition diary">
            <Row gap={18} align="center">
              <ProgressRing
                value={n?.totals.energyKcal ?? 0}
                target={t?.energyKcal ?? 0}
                color={th.c.energy}
                label={`Energy: ${Math.round(n?.totals.energyKcal ?? 0)} of ${t?.energyKcal ?? 0} kcal`}
                center={
                  <View style={{ alignItems: "center" }}>
                    <T variant="metric">{remaining == null ? "–" : Math.abs(remaining).toLocaleString()}</T>
                    <T variant="caption" color="textSecondary">
                      {remaining == null ? "no target" : remaining >= 0 ? "kcal left" : "kcal over"}
                    </T>
                  </View>
                }
              />
              <Stack gap={10} style={{ flex: 1 }}>
                {t ? (
                  <>
                    <MacroBar label="Protein" consumed={n!.totals.proteinG} target={t.proteinG} unit="g" color={th.c.protein} />
                    <Row gap={12}>
                      <MacroBar label="Carbs" consumed={n!.totals.carbsG} target={t.carbsG} unit="g" color={th.c.carbs} />
                      <MacroBar label="Fat" consumed={n!.totals.fatG} target={t.fatG} unit="g" color={th.c.fat} />
                    </Row>
                  </>
                ) : (
                  <T color="textSecondary">Set targets in Settings to track progress.</T>
                )}
              </Stack>
            </Row>
            <Row justify="space-between" style={{ marginTop: 14 }}>
              <Row gap={6}>
                <Icon name="water" size={15} color="water" />
                <T variant="footnote" color="textSecondary">
                  {(n?.water.totalMl ?? 0).toLocaleString()} {n?.water.targetMl ? `/ ${n.water.targetMl.toLocaleString()} ml` : "ml"}
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
          </Card>

          <SectionHeader title="Training" />
          <Card>
            {active ? (
              <Row justify="space-between">
                <Stack gap={2} style={{ flex: 1 }}>
                  <T variant="headline">{active.name}</T>
                  <T variant="footnote" color="textSecondary">
                    In progress · {active.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0)} sets done
                  </T>
                </Stack>
                <Button title="Resume" icon="play" size="md" onPress={() => router.push("/workout/active")} />
              </Row>
            ) : d.workout?.scheduledToday || d.workout?.nextInRotation ? (
              <Row justify="space-between">
                <Stack gap={2} style={{ flex: 1 }}>
                  <T variant="footnote" color="textSecondary">
                    {d.workout.scheduledToday ? "Planned today" : "Next up"}
                  </T>
                  <T variant="headline">{(d.workout.scheduledToday ?? d.workout.nextInRotation)!.name}</T>
                  {d.recovery.readiness === "poor" ? (
                    <T variant="footnote" color="warning">
                      Recovery signals are low. You can shorten the session from the start screen.
                    </T>
                  ) : null}
                </Stack>
                <Button title="Start" icon="play" size="md" onPress={() => router.push({ pathname: "/workout/active", params: { templateId: (d.workout!.scheduledToday ?? d.workout!.nextInRotation)!.id } })} />
              </Row>
            ) : (
              <Row justify="space-between">
                <T color="textSecondary" style={{ flex: 1 }}>
                  No program yet.
                </T>
                <Button title="Create plan" kind="secondary" size="md" onPress={() => router.push("/train")} />
              </Row>
            )}
          </Card>

          <SectionHeader title="Recovery" />
          <Card>
            <Stack gap={10}>
              <Row justify="space-between">
                <T variant="headline">How do you feel today?</T>
                <Badge label={d.recovery.readiness === "good" ? "Signals normal" : d.recovery.readiness === "normal" ? "Some signals off" : "Take it easier"} tone={d.recovery.readiness === "poor" ? "warning" : "neutral"} />
              </Row>
              <Row gap={6}>
                {(["Fresh", "Good", "OK", "Tired", "Drained"] as const).map((l, i) => (
                  <Pressable key={l} accessibilityRole="button" accessibilityLabel={`Fatigue: ${l}`} onPress={() => void checkIn(i + 1)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: pressed ? th.c.surfacePressed : th.c.surfaceRaised })}>
                    <T variant="caption" color="textSecondary">
                      {l}
                    </T>
                  </Pressable>
                ))}
              </Row>
              {d.recovery.insights.map((i) => (
                <T key={i.id} variant="footnote" color="textSecondary">
                  {i.message}
                </T>
              ))}
            </Stack>
          </Card>

          <SectionHeader title="Body" action="Log weight" onAction={() => router.push("/weigh-in")} />
          <Card onPress={() => router.push("/progress")} accessibilityLabel="Open progress">
            <Row justify="space-between">
              <Stack gap={2}>
                <T variant="footnote" color="textSecondary">
                  7-day average
                </T>
                <T variant="metric">{d.weight.sevenDayAverageKg ? `${displayBodyWeight(d.weight.sevenDayAverageKg, d.profile.unitSystem).value} ${displayBodyWeight(0, d.profile.unitSystem).unit}` : "–"}</T>
              </Stack>
              <Stack gap={2} style={{ alignItems: "flex-end" }}>
                <T variant="footnote" color="textSecondary">
                  Trend
                </T>
                <T variant="headline">
                  {d.weight.rate.kgPerWeek == null || d.weight.rate.sufficiency === "insufficient"
                    ? "Needs more weigh-ins"
                    : `${d.weight.rate.kgPerWeek >= 0 ? "+" : "−"}${displayBodyWeight(Math.abs(d.weight.rate.kgPerWeek), d.profile.unitSystem).value} ${displayBodyWeight(0, d.profile.unitSystem).unit}/wk`}
                </T>
              </Stack>
            </Row>
          </Card>

          {d.insights.length || d.pendingRecommendations.length ? (
            <>
              <SectionHeader title="Coach" action="Open" onAction={() => router.push("/coach")} />
              <Card>
                <Stack gap={10}>
                  {d.insights.map((i) => (
                    <Row key={i.id} gap={10} align="flex-start">
                      <Icon name={i.kind === "suggestion" ? "coach" : i.kind === "calculated" ? "progress" : "info"} size={16} color="accent" />
                      <T variant="subhead" style={{ flex: 1 }}>
                        {i.text}
                      </T>
                    </Row>
                  ))}
                  {d.pendingRecommendations.map((r) => (
                    <Button key={r.id} title={`Review: ${r.title}`} kind="secondary" size="md" onPress={() => router.push("/coach")} />
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
