import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { formatDuration } from "../../../features/workout/components";
import { api } from "../../../lib/api";
import { haptic } from "../../../lib/haptics";
import { kv } from "../../../lib/storage";
import type { WorkoutSummary } from "../../../lib/types";
import { StatTile } from "../../../ui/charts";
import { Badge, Button, Card, Icon, Row, SectionHeader, Stack, T } from "../../../ui/primitives";
import { Screen } from "../../../ui/Screen";

const PR_LABEL: Record<string, string> = { e1rm: "Estimated 1RM", heaviest_weight: "Heaviest weight", most_reps_at_weight: "Most reps at this weight", best_set_volume: "Best single set" };
const ACTION_TEXT: Record<string, string> = { increase_load: "Add load", increase_reps: "Add reps", maintain: "Repeat", reduce_load: "Lighter", deload: "Deload", establish_baseline: "Baseline" };

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
    <Screen close title="Workout complete" subtitle={q.data?.name ?? local?.name} footer={<Button title="Done" onPress={() => router.dismissAll()} />}>
      {base ? (
        <Row gap={8}>
          <StatTile label="Duration" value={formatDuration(base.durationSec)} />
          <StatTile label="Sets" value={String(base.workSets)} />
          <StatTile label="Reps" value={String(base.totalReps)} />
        </Row>
      ) : null}
      {base ? <T variant="caption" color="textTertiary">Volume {Math.round(base.volumeKg).toLocaleString()} kg. Volume is one view of the session, not a measure of its quality.</T> : null}
      {!s ? (
        <Card><T variant="footnote" color="textSecondary">Saving and calculating records… This finishes automatically when you're online.</T></Card>
      ) : (
        <>
          {s.personalRecords.length ? (
            <>
              <SectionHeader title="Personal records" />
              <Card>
                <Stack gap={10}>
                  {s.personalRecords.map((p, i) => (
                    <Row key={i} gap={10}>
                      <Icon name="trophy" size={18} color="warning" />
                      <View style={{ flex: 1 }}>
                        <T variant="headline">{p.exerciseName}</T>
                        <T variant="footnote" color="textSecondary">{PR_LABEL[p.kind] ?? p.kind}: {p.kind === "e1rm" ? `${Math.round(p.value * 10) / 10} kg` : p.kind === "most_reps_at_weight" ? `${p.reps} reps at ${p.weightKg} kg` : p.kind === "best_set_volume" ? `${p.weightKg} kg × ${p.reps}` : `${p.value} kg`}{p.previous != null ? ` (was ${Math.round(p.previous * 10) / 10})` : ""}</T>
                      </View>
                    </Row>
                  ))}
                </Stack>
              </Card>
            </>
          ) : null}
          <SectionHeader title="Compared with last time" />
          <Card>
            <Stack gap={8}>
              {s.comparison.map((c) => (
                <Row key={c.exerciseId} justify="space-between">
                  <T variant="subhead" style={{ flex: 1 }}>{c.exerciseName}</T>
                  <T variant="footnote" color="textSecondary">{c.previousE1rmKg && c.e1rmKg ? `${c.e1rmKg >= c.previousE1rmKg ? "+" : ""}${Math.round((c.e1rmKg - c.previousE1rmKg) * 10) / 10} kg e1RM` : "first session"}</T>
                </Row>
              ))}
            </Stack>
          </Card>
          <SectionHeader title="Next session" />
          <Card>
            <Stack gap={10}>
              {s.nextTargets.map((n) => (
                <View key={n.exerciseId} style={{ gap: 3 }}>
                  <Row justify="space-between">
                    <T variant="headline" style={{ flex: 1 }}>{n.exerciseName}</T>
                    <Badge label={ACTION_TEXT[n.action] ?? n.action} tone={n.action === "increase_load" ? "accent" : n.action === "deload" || n.action === "reduce_load" ? "warning" : "neutral"} />
                  </Row>
                  <T variant="footnote" color="textSecondary">{n.targetLoadKg != null ? `${n.targetLoadKg} kg × ${n.targetReps.join("/")}` : `${n.targetReps.join("/")} reps`} · {n.reasons.at(-1)}</T>
                </View>
              ))}
              <T variant="caption" color="textTertiary">Suggestions only. You'll be asked before any load change is used.</T>
            </Stack>
          </Card>
        </>
      )}
    </Screen>
  );
}
