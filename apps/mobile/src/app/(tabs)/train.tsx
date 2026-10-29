import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useActiveWorkout } from "../../features/workout/store";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { queryClient } from "../../lib/query";
import type { Program } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { BarList } from "../../ui/charts";
import { Badge, Button, Card, Chip, Divider, EmptyState, ErrorState, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

interface Fatigue {
  suggestDeload: boolean;
  regressingLifts: string[];
  reasons: string[];
  liftsChecked: string[];
  readiness: string;
}

/** Monday of the week after `day` (YYYY-MM-DD). */
function nextWeekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function BlockCard({ program }: { program: Program }) {
  const [editing, setEditing] = useState(false);
  const fatigue = useQuery({ queryKey: ["training-fatigue"], queryFn: () => api<Fatigue>("/v1/training/fatigue") });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.programs });
    void queryClient.invalidateQueries({ queryKey: ["template-start"] });
  };
  const setBlock = useMutation({ mutationFn: (b: { blockWeeks: number | null; restart?: boolean }) => api(`/v1/programs/${program.id}/block`, { method: "PUT", body: b }), onSuccess: () => { haptic("success"); setEditing(false); refresh(); } });
  const setDeload = useMutation({ mutationFn: (weekOf: string | null) => api(`/v1/programs/${program.id}/deload`, { method: "PUT", body: { weekOf } }), onSuccess: () => { haptic("success"); refresh(); } });
  const b = program.block;
  const today = todayKey();
  // A one-off deload still ahead (this week's is reported as deloadThisWeek).
  const scheduled = program.deloadWeekStart && !program.deloadThisWeek && program.deloadWeekStart > today ? program.deloadWeekStart : null;
  const cancellableNow = program.deloadThisWeek && !b?.deload && !!program.deloadWeekStart;
  const f = fatigue.data;
  const showFatigue = f?.suggestDeload && !program.deloadThisWeek && !scheduled;
  const err = setBlock.error ?? setDeload.error;

  return (
    <Card>
      <Stack gap={10}>
        <Row justify="space-between">
          <View style={{ flex: 1 }}>
            <T variant="headline">{program.deloadThisWeek ? "Deload week" : b ? `Week ${b.week} of ${b.of}` : "No training blocks"}</T>
            <T variant="footnote" color="textSecondary">
              {program.deloadThisWeek
                ? "Fewer sets, lighter loads, more in reserve. Workouts started this week are adjusted."
                : b
                  ? `${b.of - 1} build weeks, then a lighter week. ${b.of - b.week === 1 ? "Block deload next week." : `Block deload in ${b.of - b.week} weeks.`}`
                  : "Progress continues week to week. Deload whenever you need one."}
            </T>
          </View>
          {program.deloadThisWeek ? <Badge label="deload" tone="warning" /> : b ? <Badge label={`${b.week}/${b.of}`} tone="accent" /> : null}
        </Row>
        {scheduled ? (
          <Row justify="space-between">
            <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>Extra deload the week of {new Date(`${scheduled}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}.</T>
            <Button title="Cancel" kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(null)} />
          </Row>
        ) : null}
        {showFatigue ? (
          <View style={{ gap: 6 }}>
            <Badge label="Fatigue building" tone="warning" />
            {f.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}
            <Row gap={8} wrap>
              <Button title="Deload this week" size="sm" loading={setDeload.isPending && setDeload.variables === today} onPress={() => setDeload.mutate(today)} />
              <Button title="Next week" kind="secondary" size="sm" loading={setDeload.isPending && setDeload.variables !== today} onPress={() => setDeload.mutate(nextWeekOf(today))} />
            </Row>
            <T variant="caption" color="textTertiary">A suggestion from your last few sessions on {f.liftsChecked.join(", ")}. Nothing changes unless you choose.</T>
          </View>
        ) : null}
        {editing ? (
          <View style={{ gap: 8 }}>
            <T variant="footnote" color="textSecondary">Block length (the last week is the deload)</T>
            <Row gap={6} wrap>
              {[3, 4, 5, 6, 8].map((n) => <Chip key={n} label={`${n} weeks`} selected={program.blockWeeks === n} onPress={() => setBlock.mutate({ blockWeeks: n })} />)}
              <Chip label="Off" selected={!program.blockWeeks} onPress={() => setBlock.mutate({ blockWeeks: null })} />
            </Row>
            <Row gap={8}>
              {program.blockWeeks ? <Button title="Restart block this week" kind="secondary" size="sm" loading={setBlock.isPending} onPress={() => setBlock.mutate({ blockWeeks: program.blockWeeks, restart: true })} /> : null}
              <Button title="Done" kind="ghost" size="sm" onPress={() => setEditing(false)} />
            </Row>
          </View>
        ) : (
          <Row gap={8} wrap>
            <Button title={b ? "Change block" : "Use blocks"} kind="secondary" size="sm" onPress={() => setEditing(true)} />
            {cancellableNow ? <Button title="Skip this deload" kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(null)} /> : null}
            {!program.deloadThisWeek && !scheduled && !showFatigue ? <Button title="Deload next week" kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(nextWeekOf(today))} /> : null}
          </Row>
        )}
        {err ? <T variant="footnote" color="danger">{err instanceof ApiError ? err.message : "Couldn't save. Try again."}</T> : null}
      </Stack>
    </Card>
  );
}

interface Proposal {
  draft: unknown;
  preview: { name: string; weekday: number | null; exercises: { name: string; prescription: { sets: number; repRange: { min: number; max: number } } }[]; estimatedMinutes: number }[];
  rationale: string;
  limitationsNote: string | null;
}

export default function Train() {
  const th = useTheme();
  const active = useActiveWorkout();
  const programs = useQuery({ queryKey: qk.programs, queryFn: async () => (await api<{ items: Program[] }>("/v1/programs")).items });
  const workouts = useQuery({ queryKey: qk.workouts, queryFn: async () => (await api<{ items: { id: string; name: string; day: string; status: string; summary: { workSets: number; durationSec: number; personalRecords: unknown[] } | null }[] }>("/v1/workouts", { query: { limit: 10 } })).items });
  const analytics = useQuery({ queryKey: qk.analytics, queryFn: () => api<{ weeks: { week: string; sessions: number; setsPerMuscle: Record<string, number> }[]; notes: string[] }>("/v1/training/analytics", { query: { weeks: 4 } }) });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const generate = useMutation({ mutationFn: () => api<Proposal>("/v1/programs/generate", { body: {} }), onSuccess: setProposal });
  const save = useMutation({
    mutationFn: () => api<Program>("/v1/programs", { body: proposal!.draft }),
    onSuccess: () => {
      haptic("success");
      setProposal(null);
      void queryClient.invalidateQueries({ queryKey: qk.programs });
      void queryClient.invalidateQueries({ queryKey: qk.today });
    },
  });
  const program = programs.data?.[0];
  const thisWeek = analytics.data?.weeks.at(-1);

  return (
    <Screen tabBar title="Train" onRefresh={() => { void programs.refetch(); void workouts.refetch(); void analytics.refetch(); }} refreshing={programs.isRefetching}>
      {active ? (
        <Card onPress={() => router.push("/workout/active")} accessibilityLabel="Resume workout">
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <T variant="footnote" color="accent">In progress</T>
              <T variant="headline">{active.name}</T>
            </View>
            <Button title="Resume" size="md" icon="play" onPress={() => router.push("/workout/active")} />
          </Row>
        </Card>
      ) : null}

      {programs.isPending ? <Skeleton height={160} /> : programs.isError ? <ErrorState error={programs.error} onRetry={() => void programs.refetch()} /> : program ? (
        <>
          <SectionHeader title={program.name} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {program.days.map((d, i) => (
              <View key={d.id}>
                {i ? <Divider /> : null}
                <ListRow
                  title={d.name}
                  subtitle={`${d.weekday ? WEEKDAY[d.weekday] + " · " : ""}${d.exercises.map((e) => e.exercise.name).slice(0, 3).join(", ")}${d.exercises.length > 3 ? ` +${d.exercises.length - 3}` : ""}`}
                  right={<Button title="Start" size="sm" kind={active ? "secondary" : "primary"} disabled={!!active} onPress={() => router.push({ pathname: "/workout/active", params: { templateId: d.id } })} />}
                />
              </View>
            ))}
          </Card>
          <BlockCard program={program} />
          <T variant="caption" color="textTertiary">Version {program.version}{program.createdBy === "ai" ? " · suggested by coach" : ""}. Edits create a new version; history is kept.</T>
        </>
      ) : proposal ? (
        <>
          <SectionHeader title="Suggested program" />
          <Card>
            <Stack gap={12}>
              <T variant="footnote" color="textSecondary">{proposal.rationale}</T>
              {proposal.preview.map((d) => (
                <View key={d.name} style={{ gap: 4 }}>
                  <Row justify="space-between"><T variant="headline">{d.name}</T><T variant="caption" color="textTertiary">~{d.estimatedMinutes} min</T></Row>
                  {d.exercises.map((e) => <T key={e.name} variant="footnote" color="textSecondary">{e.name} · {e.prescription.sets} × {e.prescription.repRange.min}{e.prescription.repRange.max !== e.prescription.repRange.min ? `–${e.prescription.repRange.max}` : ""}</T>)}
                </View>
              ))}
              {proposal.limitationsNote ? <T variant="footnote" color="warning">{proposal.limitationsNote}</T> : null}
              <Row gap={8}>
                <Button title="Regenerate" kind="secondary" size="md" onPress={() => generate.mutate()} style={{ flex: 1 }} />
                <Button title="Use this program" size="md" onPress={() => save.mutate()} loading={save.isPending} style={{ flex: 1.4 }} />
              </Row>
            </Stack>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState icon="train" title="No program yet" body="Build one from your schedule, equipment and experience. You can edit every exercise." action={generate.isPending ? "Building…" : "Suggest a program"} onAction={() => generate.mutate()} />
          {generate.error ? <T variant="footnote" color="danger">{generate.error instanceof ApiError ? generate.error.message : "Failed"}</T> : null}
        </Card>
      )}

      <Row gap={8}>
        <Button title="Empty workout" kind="secondary" icon="add" size="md" disabled={!!active} onPress={() => router.push({ pathname: "/workout/active", params: { empty: "1" } })} style={{ flex: 1 }} />
        <Button title="Form check" kind="secondary" icon="camera" size="md" onPress={() => router.push("/workout/form-check")} style={{ flex: 1 }} />
      </Row>

      <SectionHeader title="This week" />
      <Card>
        {thisWeek && Object.keys(thisWeek.setsPerMuscle).length ? (
          <Stack gap={10}>
            <Row justify="space-between"><T variant="headline">{thisWeek.sessions} session{thisWeek.sessions === 1 ? "" : "s"}</T><Badge label="hard sets per muscle" /></Row>
            <BarList items={Object.entries(thisWeek.setsPerMuscle).slice(0, 8).map(([k, v]) => ({ label: pretty(k), value: v }))} color={th.c.protein} />
            <T variant="caption" color="textTertiary">{analytics.data?.notes[0]}</T>
          </Stack>
        ) : (
          <EmptyState icon="progress" title="No sets logged this week" />
        )}
      </Card>

      <SectionHeader title="Recent workouts" />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {workouts.data?.length ? workouts.data.map((w, i) => (
          <View key={w.id}>
            {i ? <Divider /> : null}
            <ListRow title={w.name} subtitle={`${w.day}${w.summary ? ` · ${w.summary.workSets} sets · ${Math.round(w.summary.durationSec / 60)} min` : w.status === "active" ? " · in progress" : ""}`} onPress={() => w.summary && router.push({ pathname: "/workout/summary/[id]", params: { id: w.id } })} right={w.summary?.personalRecords.length ? <Badge label={`${w.summary.personalRecords.length} PR`} tone="warning" /> : undefined} />
          </View>
        )) : <EmptyState icon="history" title="No workouts yet" />}
      </Card>
    </Screen>
  );
}
