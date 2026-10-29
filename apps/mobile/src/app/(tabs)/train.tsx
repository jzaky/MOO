import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { muscleLabel } from "../../features/workout/components";
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
import { fmtDay, t, tn } from "../../i18n";


function weekdayShort(d: number): string {
  switch (d) {
    case 1: return t("Mon");
    case 2: return t("Tue");
    case 3: return t("Wed");
    case 4: return t("Thu");
    case 5: return t("Fri");
    case 6: return t("Sat");
    case 7: return t("Sun");
    default: return "";
  }
}


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
            <T variant="headline">{program.deloadThisWeek ? t("Deload week") : b ? t("Week {week} of {of}", { week: b.week, of: b.of }) : t("No training blocks")}</T>
            <T variant="footnote" color="textSecondary">
              {program.deloadThisWeek
                ? t("Fewer sets, lighter loads, more in reserve. Workouts started this week are adjusted.")
                : b
                  ? `${tn(b.of - 1, "{n} build week, then a lighter week.", "{n} build weeks, then a lighter week.")} ${b.of - b.week === 1 ? t("Block deload next week.") : tn(b.of - b.week, "Block deload in {n} week.", "Block deload in {n} weeks.")}`
                  : t("Progress continues week to week. Deload whenever you need one.")}
            </T>
          </View>
          {program.deloadThisWeek ? <Badge label={t("deload")} tone="warning" /> : b ? <Badge label={`${b.week}/${b.of}`} tone="accent" /> : null}
        </Row>
        {scheduled ? (
          <Row justify="space-between">
            <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{t("Extra deload the week of {date}.", { date: fmtDay(scheduled) })}</T>
            <Button title={t("Cancel")} kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(null)} />
          </Row>
        ) : null}
        {showFatigue ? (
          <View style={{ gap: 6 }}>
            <Badge label={t("Fatigue building")} tone="warning" />
            {f.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}
            <Row gap={8} wrap>
              <Button title={t("Deload this week")} size="sm" loading={setDeload.isPending && setDeload.variables === today} onPress={() => setDeload.mutate(today)} />
              <Button title={t("Next week")} kind="secondary" size="sm" loading={setDeload.isPending && setDeload.variables !== today} onPress={() => setDeload.mutate(nextWeekOf(today))} />
            </Row>
            <T variant="caption" color="textTertiary">{t("A suggestion from your last few sessions on {lifts}. Nothing changes unless you choose.", { lifts: f.liftsChecked.join(t(", ")) })}</T>
          </View>
        ) : null}
        {editing ? (
          <View style={{ gap: 8 }}>
            <T variant="footnote" color="textSecondary">{t("Block length (the last week is the deload)")}</T>
            <Row gap={6} wrap>
              {[3, 4, 5, 6, 8].map((n) => <Chip key={n} label={tn(n, "{n} week", "{n} weeks")} selected={program.blockWeeks === n} onPress={() => setBlock.mutate({ blockWeeks: n })} />)}
              <Chip label={t("Off")} selected={!program.blockWeeks} onPress={() => setBlock.mutate({ blockWeeks: null })} />
            </Row>
            <Row gap={8}>
              {program.blockWeeks ? <Button title={t("Restart block this week")} kind="secondary" size="sm" loading={setBlock.isPending} onPress={() => setBlock.mutate({ blockWeeks: program.blockWeeks, restart: true })} /> : null}
              <Button title={t("Done")} kind="ghost" size="sm" onPress={() => setEditing(false)} />
            </Row>
          </View>
        ) : (
          <Row gap={8} wrap>
            <Button title={b ? t("Change block") : t("Use blocks")} kind="secondary" size="sm" onPress={() => setEditing(true)} />
            {cancellableNow ? <Button title={t("Skip this deload")} kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(null)} /> : null}
            {!program.deloadThisWeek && !scheduled && !showFatigue ? <Button title={t("Deload next week")} kind="ghost" size="sm" loading={setDeload.isPending} onPress={() => setDeload.mutate(nextWeekOf(today))} /> : null}
          </Row>
        )}
        {err ? <T variant="footnote" color="danger">{err instanceof ApiError ? err.message : t("Couldn't save. Try again.")}</T> : null}
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
    <Screen tabBar title={t("Train")} onRefresh={() => { void programs.refetch(); void workouts.refetch(); void analytics.refetch(); }} refreshing={programs.isRefetching}>
      {active ? (
        <Card onPress={() => router.push("/workout/active")} accessibilityLabel={t("Resume workout")}>
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <T variant="footnote" color="accent">{t("In progress")}</T>
              <T variant="headline">{active.name}</T>
            </View>
            <Button title={t("Resume")} size="md" icon="play" onPress={() => router.push("/workout/active")} />
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
                  subtitle={`${d.weekday ? weekdayShort(d.weekday) + " · " : ""}${d.exercises.map((e) => e.exercise.name).slice(0, 3).join(", ")}${d.exercises.length > 3 ? ` +${d.exercises.length - 3}` : ""}`}
                  right={<Button title={t("Start")} size="sm" kind={active ? "secondary" : "primary"} disabled={!!active} onPress={() => router.push({ pathname: "/workout/active", params: { templateId: d.id } })} />}
                />
              </View>
            ))}
          </Card>
          <BlockCard program={program} />
          <T variant="caption" color="textTertiary">{program.createdBy === "ai" ? t("Version {v} · suggested by coach. Edits create a new version; history is kept.", { v: program.version }) : t("Version {v}. Edits create a new version; history is kept.", { v: program.version })}</T>
        </>
      ) : proposal ? (
        <>
          <SectionHeader title={t("Suggested program")} />
          <Card>
            <Stack gap={12}>
              <T variant="footnote" color="textSecondary">{proposal.rationale}</T>
              {proposal.preview.map((d) => (
                <View key={d.name} style={{ gap: 4 }}>
                  <Row justify="space-between"><T variant="headline">{d.name}</T><T variant="caption" color="textTertiary">{t("~{m} min", { m: d.estimatedMinutes })}</T></Row>
                  {d.exercises.map((e) => <T key={e.name} variant="footnote" color="textSecondary">{e.name} · {e.prescription.sets} × {e.prescription.repRange.min}{e.prescription.repRange.max !== e.prescription.repRange.min ? `–${e.prescription.repRange.max}` : ""}</T>)}
                </View>
              ))}
              {proposal.limitationsNote ? <T variant="footnote" color="warning">{proposal.limitationsNote}</T> : null}
              <Row gap={8}>
                <Button title={t("Regenerate")} kind="secondary" size="md" onPress={() => generate.mutate()} style={{ flex: 1 }} />
                <Button title={t("Use this program")} size="md" onPress={() => save.mutate()} loading={save.isPending} style={{ flex: 1.4 }} />
              </Row>
            </Stack>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState icon="train" title={t("No program yet")} body={t("Build one from your schedule, equipment and experience. You can edit every exercise.")} action={generate.isPending ? t("Building…") : t("Suggest a program")} onAction={() => generate.mutate()} />
          {generate.error ? <T variant="footnote" color="danger">{generate.error instanceof ApiError ? generate.error.message : t("Something went wrong. Try again.")}</T> : null}
        </Card>
      )}

      <Row gap={8}>
        <Button title={t("Empty workout")} kind="secondary" icon="add" size="md" disabled={!!active} onPress={() => router.push({ pathname: "/workout/active", params: { empty: "1" } })} style={{ flex: 1 }} />
        <Button title={t("Form check")} kind="secondary" icon="camera" size="md" onPress={() => router.push("/workout/form-check")} style={{ flex: 1 }} />
      </Row>

      <SectionHeader title={t("This week")} />
      <Card>
        {thisWeek && Object.keys(thisWeek.setsPerMuscle).length ? (
          <Stack gap={10}>
            <Row justify="space-between"><T variant="headline">{tn(thisWeek.sessions, "{n} session", "{n} sessions")}</T><Badge label={t("hard sets per muscle")} /></Row>
            <BarList items={Object.entries(thisWeek.setsPerMuscle).slice(0, 8).map(([k, v]) => ({ label: muscleLabel(k), value: v }))} color={th.c.protein} />
            <T variant="caption" color="textTertiary">{analytics.data?.notes[0]}</T>
          </Stack>
        ) : (
          <EmptyState icon="progress" title={t("No sets logged this week")} />
        )}
      </Card>

      <SectionHeader title={t("Recent workouts")} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {workouts.data?.length ? workouts.data.map((w, i) => (
          <View key={w.id}>
            {i ? <Divider /> : null}
            <ListRow title={w.name} subtitle={`${fmtDay(w.day)}${w.summary ? ` · ${tn(w.summary.workSets, "{n} set", "{n} sets")} · ${t("{m} min", { m: Math.round(w.summary.durationSec / 60) })}` : w.status === "active" ? ` · ${t("in progress")}` : ""}`} onPress={() => w.summary && router.push({ pathname: "/workout/summary/[id]", params: { id: w.id } })} right={w.summary?.personalRecords.length ? <Badge label={tn(w.summary.personalRecords.length, "{n} PR", "{n} PRs")} tone="warning" /> : undefined} />
          </View>
        )) : <EmptyState icon="history" title={t("No workouts yet")} />}
      </Card>
    </Screen>
  );
}
