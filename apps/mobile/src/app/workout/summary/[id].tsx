import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { actionLabel, formatDuration } from "../../../features/workout/components";
import { fmtNum, t, tn } from "../../../i18n";
import { api } from "../../../lib/api";
import { haptic } from "../../../lib/haptics";
import { kv } from "../../../lib/storage";
import type { WorkoutSummary } from "../../../lib/types";
import { StatTile } from "../../../ui/charts";
import { Badge, Button, Card, Icon, Row, SectionHeader, Stack, T } from "../../../ui/primitives";
import { Screen } from "../../../ui/Screen";

function prLabel(kind: string): string {
  switch (kind) {
    case "e1rm": return t("Estimated 1RM");
    case "heaviest_weight": return t("Heaviest weight");
    case "most_reps_at_weight": return t("Most reps at this weight");
    case "best_set_volume": return t("Best single set");
    default: return kind;
  }
}

export default function Summary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The completed snapshot syncs via the outbox; poll until the server summary (PRs, next targets) exists.
  const q = useQuery({ queryKey: ["workout", id], queryFn: () => api<{ name: string; summary: WorkoutSummary | null }>(`/v1/workouts/${id}`), refetchInterval: (query) => (query.state.data?.summary ? false : 2000), retry: true });
  const local = kv.get<{ id: string; name: string; durationSec: number; workSets: number; totalReps: number; volumeKg: number }>("workout.lastLocalSummary");
  const s = q.data?.summary;
  const base = s ?? (local?.id === id ? local : null);
  useEffect(() => {
    if (s?.personalRecords.length) haptic("pr");
  }, [s?.personalRecords.length]);

  return (
    <Screen close title={t("Workout complete")} subtitle={q.data?.name ?? local?.name} footer={<Button title={t("Done")} onPress={() => router.dismissAll()} />}>
      {base ? (
        <Row gap={8}>
          <StatTile label={t("Duration")} value={formatDuration(base.durationSec)} />
          <StatTile label={t("Sets")} value={String(base.workSets)} />
          <StatTile label={t("Reps")} value={String(base.totalReps)} />
        </Row>
      ) : null}
      {base ? <T variant="caption" color="textTertiary">{t("Volume {kg} kg. Volume is one view of the session, not a measure of its quality.", { kg: fmtNum(Math.round(base.volumeKg)) })}</T> : null}
      {!s ? (
        <Card><T variant="footnote" color="textSecondary">{t("Saving and calculating records… This finishes automatically when you're online.")}</T></Card>
      ) : (
        <>
          {s.personalRecords.length ? (
            <>
              <SectionHeader title={t("Personal records")} />
              <Card>
                <Stack gap={10}>
                  {s.personalRecords.map((p, i) => (
                    <Row key={i} gap={10}>
                      <Icon name="trophy" size={18} color="warning" />
                      <View style={{ flex: 1 }}>
                        <T variant="headline">{p.exerciseName}</T>
                        <T variant="footnote" color="textSecondary">{prLabel(p.kind)}: {p.kind === "e1rm" ? `${Math.round(p.value * 10) / 10} kg` : p.kind === "most_reps_at_weight" ? tn(p.reps, "{n} rep at {kg} kg", "{n} reps at {kg} kg", { kg: p.weightKg }) : p.kind === "best_set_volume" ? `${p.weightKg} kg × ${p.reps}` : `${p.value} kg`}{p.previous != null ? ` ${t("(was {value})", { value: Math.round(p.previous * 10) / 10 })}` : ""}</T>
                      </View>
                    </Row>
                  ))}
                </Stack>
              </Card>
            </>
          ) : null}
          <SectionHeader title={t("Compared with last time")} />
          <Card>
            <Stack gap={8}>
              {s.comparison.map((c) => (
                <Row key={c.exerciseId} justify="space-between">
                  <T variant="subhead" style={{ flex: 1 }}>{c.exerciseName}</T>
                  <T variant="footnote" color="textSecondary">{c.previousE1rmKg && c.e1rmKg ? t("{change} kg e1RM", { change: `${c.e1rmKg >= c.previousE1rmKg ? "+" : ""}${Math.round((c.e1rmKg - c.previousE1rmKg) * 10) / 10}` }) : t("first session")}</T>
                </Row>
              ))}
            </Stack>
          </Card>
          <SectionHeader title={t("Next session")} />
          <Card>
            <Stack gap={10}>
              {s.nextTargets.map((n) => (
                <View key={n.exerciseId} style={{ gap: 3 }}>
                  <Row justify="space-between">
                    <T variant="headline" style={{ flex: 1 }}>{n.exerciseName}</T>
                    <Badge label={actionLabel(n.action)} tone={n.action === "increase_load" ? "accent" : n.action === "deload" || n.action === "reduce_load" ? "warning" : "neutral"} />
                  </Row>
                  <T variant="footnote" color="textSecondary">{n.targetLoadKg != null ? `${n.targetLoadKg} kg × ${n.targetReps.join("/")}` : t("{reps} reps", { reps: n.targetReps.join("/") })} · {n.reasons.at(-1)}</T>
                </View>
              ))}
              <T variant="caption" color="textTertiary">{t("Suggestions only. You'll be asked before any load change is used.")}</T>
            </Stack>
          </Card>
        </>
      )}
    </Screen>
  );
}
