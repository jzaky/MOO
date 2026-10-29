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
import { Badge, Button, Card, Divider, EmptyState, ErrorState, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

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

      <Button title="Start empty workout" kind="secondary" icon="add" disabled={!!active} onPress={() => router.push({ pathname: "/workout/active", params: { empty: "1" } })} />

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
