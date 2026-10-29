import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { addExercise, replaceExercise } from "../../features/workout/store";
import { api } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import type { Exercise } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { LineChart } from "../../ui/charts";
import { Badge, Button, Card, Chip, Divider, EmptyState, Field, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const MUSCLES = ["chest", "lats", "upper_back", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "abs"];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ExerciseInfo({ id }: { id: string }) {
  const th = useTheme();
  const ex = useQuery({ queryKey: qk.exercise(id), queryFn: () => api<Exercise>(`/v1/exercises/${id}`), staleTime: 24 * 3600_000 });
  const hist = useQuery({ queryKey: qk.exerciseHistory(id), queryFn: () => api<{ sessions: { day: string; sets: { weightKg: number; reps: number; kind: string }[]; bestE1rmKg: number | null }[]; e1rmTrend: { day: string; e1rmKg: number }[]; personalRecords: { kind: string; value: number; day: string }[] }>(`/v1/exercises/${id}/history`) });
  const e = ex.data;
  if (!e) return <Screen close title="Exercise"><Skeleton height={120} /></Screen>;
  const toX = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return (
    <Screen close title={e.name} subtitle={`${e.primaryMuscles.map(pretty).join(", ")} · ${pretty(e.equipment)}`}>
      <Card>
        <Stack gap={8}>
          {e.instructions.map((s, i) => <Row key={i} gap={10} align="flex-start"><T variant="footnote" color="accent" weight="700">{i + 1}</T><T variant="subhead" style={{ flex: 1 }}>{s}</T></Row>)}
          {e.cautions ? <T variant="footnote" color="warning">{e.cautions}</T> : null}
          {e.secondaryMuscles.length ? <T variant="caption" color="textTertiary">Also works: {e.secondaryMuscles.map(pretty).join(", ")}</T> : null}
        </Stack>
      </Card>
      {hist.data?.e1rmTrend.length && hist.data.e1rmTrend.length >= 2 ? (
        <>
          <SectionHeader title="Estimated 1RM" />
          <Card>
            <LineChart title={`${e.name} estimated one-rep max`} series={[{ key: "e1rm", label: "Estimated 1RM", color: th.c.protein, points: hist.data.e1rmTrend.map((p) => ({ x: toX(p.day), y: Math.round(p.e1rmKg * 10) / 10 })) }]} formatY={(v) => `${Math.round(v)}`} formatX={(x) => new Date(x * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} height={160} />
            <T variant="caption" color="textTertiary" style={{ marginTop: 6 }}>Estimated from your best set each session (Epley). Not a tested max.</T>
          </Card>
        </>
      ) : null}
      <SectionHeader title="History" />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {hist.data?.sessions.length ? hist.data.sessions.slice().reverse().slice(0, 10).map((s, i) => (
          <View key={s.day + i}>{i ? <Divider /> : null}<ListRow title={s.day} subtitle={s.sets.filter((x) => x.kind !== "warmup").map((x) => `${x.weightKg}×${x.reps}`).join(", ")} /></View>
        )) : <EmptyState icon="history" title="No history yet" />}
      </Card>
      {e.alternativeExercises?.length ? (
        <>
          <SectionHeader title="Alternatives" />
          <Row gap={8} wrap>{e.alternativeExercises.map((a) => <Chip key={a.id} label={a.name} onPress={() => router.setParams({ info: a.id })} />)}</Row>
        </>
      ) : null}
    </Screen>
  );
}

export default function ExercisePicker() {
  const params = useLocalSearchParams<{ replace?: string; info?: string }>();
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const list = useQuery({ queryKey: qk.exercises(`${q}|${muscle ?? ""}`), queryFn: () => api<{ items: Exercise[] }>("/v1/exercises", { query: { q: q.trim() || undefined, muscle: muscle ?? undefined } }), staleTime: 24 * 3600_000 });
  if (params.info) return <ExerciseInfo id={params.info} />;
  const pick = (e: Exercise) => {
    if (params.replace) replaceExercise(params.replace, e);
    else addExercise(e);
    haptic("light");
    router.back();
  };
  return (
    <Screen close title={params.replace ? "Replace exercise" : "Add exercise"}>
      <Field value={q} onChangeText={setQ} placeholder="Search exercises" autoFocus accessibilityLabel="Search exercises" />
      <Row gap={6} wrap>{MUSCLES.map((m) => <Chip key={m} label={pretty(m)} selected={muscle === m} onPress={() => setMuscle(muscle === m ? null : m)} />)}</Row>
      {list.isPending ? <Skeleton height={200} /> : (
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {list.data?.items.length ? list.data.items.slice(0, 60).map((e, i) => (
            <View key={e.id}>{i ? <Divider /> : null}<ListRow title={e.name} subtitle={`${e.primaryMuscles.map(pretty).join(", ")} · ${pretty(e.equipment)}`} onPress={() => pick(e)} right={e.isCustom ? <Badge label="custom" /> : undefined} /></View>
          )) : <EmptyState title="No exercises found" />}
        </Card>
      )}
      {q.trim().length >= 3 ? (
        <Button
          title={`Create “${q.trim()}”`}
          kind="secondary"
          size="md"
          icon="add"
          onPress={async () => pick(await api<Exercise>("/v1/exercises", { body: { name: q.trim(), primaryMuscles: [muscle ?? "other"], equipment: "other" } }))}
        />
      ) : null}
    </Screen>
  );
}
