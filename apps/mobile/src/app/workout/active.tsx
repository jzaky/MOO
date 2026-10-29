import { summarizeWorkout } from "@stoke/core";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExerciseBlock, formatDuration, RestTimer, useNow } from "../../features/workout/components";
import { discardWorkout, elapsedSec, finishWorkout, startEmpty, startFromTemplate, togglePause, useActiveWorkout } from "../../features/workout/store";
import { api } from "../../lib/api";
import { useProfile } from "../../lib/data";
import { kv } from "../../lib/storage";
import type { StartWorkout } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, ErrorState, IconButton, Row, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

function confirm(title: string, message: string, action: string, onYes: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: action, style: action === "Discard" ? "destructive" : "default", onPress: onYes }]);
}

function PreStart({ templateId }: { templateId: string }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const start = useQuery({ queryKey: ["template-start", templateId, minutes], queryFn: () => api<StartWorkout>(`/v1/templates/${templateId}/start`, { query: { minutes } }) });
  const s = start.data;
  return (
    <Screen close title={s?.template.name ?? "Workout"} subtitle={s ? `${s.items.length} exercises${s.shortened ? " · shortened" : ""}` : undefined} footer={s ? <Button title="Start workout" icon="play" onPress={() => { startFromTemplate(s); }} /> : undefined}>
      {start.isPending ? <ActivityIndicator /> : start.isError ? <ErrorState error={start.error} onRetry={() => void start.refetch()} /> : s ? (
        <>
          {s.deload ? (
            <Card>
              <Stack gap={6}>
                <Badge label={s.block?.deload ? `Deload week · week ${s.block.week} of ${s.block.of}` : "Deload week"} tone="warning" />
                <T variant="footnote" color="textSecondary">Sets are cut to about 60%, loads go one step lighter and you stop further from failure. You'll come back stronger next week.</T>
              </Stack>
            </Card>
          ) : s.block ? (
            <T variant="footnote" color="textSecondary">Week {s.block.week} of {s.block.of} in this block.</T>
          ) : null}
          {s.readiness !== "good" ? (
            <Card>
              <Stack gap={6}>
                <Badge label={s.readiness === "poor" ? "Recovery signals are low" : "Some signals are off"} tone="warning" />
                {s.recoveryInsights.map((i) => <T key={i.id} variant="footnote" color="textSecondary">{i.message}</T>)}
                <T variant="footnote" color="textSecondary">Progression suggestions already account for this. A shorter session is an option, not a requirement.</T>
              </Stack>
            </Card>
          ) : null}
          <Row gap={8} wrap>
            <Button title="Full session" kind={minutes === null ? "primary" : "secondary"} size="sm" onPress={() => setMinutes(null)} />
            {[30, 45].map((m) => <Button key={m} title={`${m} min version`} kind={minutes === m ? "primary" : "secondary"} size="sm" onPress={() => setMinutes(m)} />)}
          </Row>
          {s.items.map((it) => (
            <Card key={it.templateExerciseId}>
              <Row justify="space-between">
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="headline">{it.exercise.name}</T>
                  <T variant="footnote" color="textSecondary">{it.prescription.sets} × {it.prescription.repRange.min}{it.prescription.repRange.max !== it.prescription.repRange.min ? `–${it.prescription.repRange.max}` : ""}{it.previous ? ` · last: ${it.previous.sets.filter((x) => x.kind !== "warmup").map((x) => `${x.weightKg}×${x.reps}`).join(", ")}` : ""}</T>
                </View>
                <Badge label={it.recommendation.action.replace(/_/g, " ")} tone={it.recommendation.action === "increase_load" ? "accent" : it.recommendation.action === "deload" || it.recommendation.action === "reduce_load" ? "warning" : "neutral"} />
              </Row>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

export default function ActiveWorkoutScreen() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ templateId?: string; empty?: string }>();
  const w = useActiveWorkout();
  const profile = useProfile();
  const units = (profile.data?.unitSystem ?? "metric") as "metric" | "imperial";
  const now = useNow(1000);

  if (!w) {
    if (params.templateId) return <PreStart templateId={params.templateId} />;
    return (
      <Screen close title="Start a workout" footer={<Button title="Start empty workout" icon="play" onPress={() => startEmpty()} />}>
        <T color="textSecondary">Add exercises as you go. Everything is saved on this device first, so it works without signal.</T>
      </Screen>
    );
  }

  const finish = () => {
    const done = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0);
    if (!done) return confirm("Nothing completed yet", "Mark at least one set done, or discard this workout.", "Discard", () => { discardWorkout(); router.back(); });
    confirm("Finish workout?", `${done} set${done > 1 ? "s" : ""} completed.`, "Finish", () => {
      const sets = w.exercises.map((e) => e.sets);
      kv.set("workout.lastLocalSummary", { id: w.id, name: w.name, ...summarizeWorkout(new Date(w.startedAt), new Date(), sets, w.pausedSec) });
      const id = finishWorkout();
      if (id) router.replace({ pathname: "/workout/summary/[id]", params: { id } });
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: th.c.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: th.c.hairline }}>
        <Row justify="space-between">
          <IconButton icon="back" label="Minimise workout" onPress={() => router.back()} />
          <View style={{ alignItems: "center" }}>
            <T variant="headline" numberOfLines={1}>{w.name}</T>
            <T variant="metricS" color={w.pausedAt ? "warning" : "textSecondary"}>{w.pausedAt ? "Paused · " : ""}{formatDuration(elapsedSec(w, now))}</T>
          </View>
          <Row gap={4}>
            <IconButton icon={w.pausedAt ? "play" : "pause"} label={w.pausedAt ? "Resume" : "Pause"} onPress={togglePause} />
            <Button title="Finish" size="sm" onPress={finish} />
          </Row>
        </Row>
        {w.rest ? <RestTimer rest={w.rest} /> : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        {w.exercises.map((ex) => (
          <ExerciseBlock key={ex.id} ex={ex} workout={w} units={units} onReplace={() => router.push({ pathname: "/workout/exercise-picker", params: { replace: ex.id } })} onInfo={() => router.push({ pathname: "/workout/exercise-picker", params: { info: ex.exerciseId } })} />
        ))}
        <Button title="Add exercise" kind="secondary" icon="add" onPress={() => router.push("/workout/exercise-picker")} />
        <Button title="Discard workout" kind="ghost" onPress={() => confirm("Discard workout?", "Logged sets in this session will be removed.", "Discard", () => { discardWorkout(); router.back(); })} />
      </ScrollView>
    </View>
  );
}
