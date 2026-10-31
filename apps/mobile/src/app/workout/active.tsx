import { summarizeWorkout } from "@stoke/core";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FocusView } from "../../features/workout/FocusView";
import { ActivityIndicator, Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { actionLabel, ExerciseBlock, formatDuration, RestTimer, useNow } from "../../features/workout/components";
import { discardWorkout, elapsedSec, finishWorkout, startEmpty, startFromTemplate, togglePause, useActiveWorkout } from "../../features/workout/store";
import { api } from "../../lib/api";
import { useProfile } from "../../lib/data";
import { kv } from "../../lib/storage";
import type { StartWorkout } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, ErrorState, IconButton, Row, Segmented, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { t, tn } from "../../i18n";

function confirm(title: string, message: string, action: string, onYes: () => void, destructive = false) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [{ text: t("Cancel"), style: "cancel" }, { text: action, style: destructive ? "destructive" : "default", onPress: onYes }]);
}

function PreStart({ templateId }: { templateId: string }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const start = useQuery({ queryKey: ["template-start", templateId, minutes], queryFn: () => api<StartWorkout>(`/v1/templates/${templateId}/start`, { query: { minutes } }) });
  const s = start.data;
  return (
    <Screen close title={s?.template.name ?? t("Workout")} subtitle={s ? `${tn(s.items.length, "{n} exercise", "{n} exercises")}${s.shortened ? ` · ${t("shortened")}` : ""}` : undefined} footer={s ? <Button title={t("Start workout")} icon="play" onPress={() => { startFromTemplate(s); }} /> : undefined}>
      {start.isPending ? <ActivityIndicator /> : start.isError ? <ErrorState error={start.error} onRetry={() => void start.refetch()} /> : s ? (
        <>
          {s.deload ? (
            <Card>
              <Stack gap={6}>
                <Badge label={s.block?.deload ? t("Deload week · week {week} of {of}", { week: s.block.week, of: s.block.of }) : t("Deload week")} tone="warning" />
                <T variant="footnote" color="textSecondary">{t("Sets are cut to about 60%, loads go one step lighter and you stop further from failure. You'll come back stronger next week.")}</T>
              </Stack>
            </Card>
          ) : s.block ? (
            <T variant="footnote" color="textSecondary">{t("Week {week} of {of} in this block.", { week: s.block.week, of: s.block.of })}</T>
          ) : null}
          {s.readiness !== "good" ? (
            <Card>
              <Stack gap={6}>
                <Badge label={s.readiness === "poor" ? t("Recovery signals are low") : t("Some signals are off")} tone="warning" />
                {s.recoveryInsights.map((i) => <T key={i.id} variant="footnote" color="textSecondary">{i.message}</T>)}
                <T variant="footnote" color="textSecondary">{t("Progression suggestions already account for this. A shorter session is an option, not a requirement.")}</T>
              </Stack>
            </Card>
          ) : null}
          <Row gap={8} wrap>
            <Button title={t("Full session")} kind={minutes === null ? "primary" : "secondary"} size="sm" onPress={() => setMinutes(null)} />
            {[30, 45].map((m) => <Button key={m} title={t("{m} min version", { m })} kind={minutes === m ? "primary" : "secondary"} size="sm" onPress={() => setMinutes(m)} />)}
          </Row>
          {s.items.map((it) => (
            <Card key={it.templateExerciseId}>
              <Row justify="space-between">
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="headline">{it.exercise.name}</T>
                  <T variant="footnote" color="textSecondary">{it.prescription.sets} × {it.prescription.repRange.min}{it.prescription.repRange.max !== it.prescription.repRange.min ? `–${it.prescription.repRange.max}` : ""}{it.previous ? ` · ${t("last: {sets}", { sets: it.previous.sets.filter((x) => x.kind !== "warmup").map((x) => `${x.weightKg}×${x.reps}`).join(", ") })}` : ""}</T>
                </View>
                <Badge label={actionLabel(it.recommendation.action)} tone={it.recommendation.action === "increase_load" ? "accent" : it.recommendation.action === "deload" || it.recommendation.action === "reduce_load" ? "warning" : "neutral"} />
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
  // Focus (one set at a time) by default; the full list stays one tap away. Remembered on this device.
  const [view, setViewState] = useState<"focus" | "list">(() => kv.get<"focus" | "list">("workout.view") ?? "focus");
  const setView = (v: "focus" | "list") => {
    kv.set("workout.view", v);
    setViewState(v);
  };

  if (!w) {
    if (params.templateId) return <PreStart templateId={params.templateId} />;
    return (
      <Screen close title={t("Start a workout")} footer={<Button title={t("Start empty workout")} icon="play" onPress={() => startEmpty(t("Workout"))} />}>
        <T color="textSecondary">{t("Add exercises as you go. Everything is saved on this device first, so it works without signal.")}</T>
      </Screen>
    );
  }

  const finish = () => {
    const done = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0);
    if (!done) return confirm(t("Nothing completed yet"), t("Mark at least one set done, or discard this workout."), t("Discard"), () => { discardWorkout(); router.back(); }, true);
    confirm(t("Finish workout?"), tn(done, "{n} set completed.", "{n} sets completed."), t("Finish"), () => {
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
          <IconButton icon="back" label={t("Minimise workout")} onPress={() => router.back()} />
          <View style={{ alignItems: "center" }}>
            <T variant="headline" numberOfLines={1}>{w.name}</T>
            <T variant="metricS" color={w.pausedAt ? "warning" : "textSecondary"}>{w.pausedAt ? t("Paused · {time}", { time: formatDuration(elapsedSec(w, now)) }) : formatDuration(elapsedSec(w, now))}</T>
          </View>
          <Row gap={4}>
            <IconButton icon={w.pausedAt ? "play" : "pause"} label={w.pausedAt ? t("Resume") : t("Pause")} onPress={togglePause} />
            <Button title={t("Finish")} size="sm" onPress={finish} />
          </Row>
        </Row>
        <Segmented options={[{ value: "focus", label: t("Focus") }, { value: "list", label: t("All sets") }]} value={view} onChange={setView} />
        {w.rest && view === "list" ? <RestTimer rest={w.rest} /> : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        {view === "focus" ? (
          <FocusView w={w} units={units} onFinish={finish} />
        ) : w.exercises.map((ex) => (
          <ExerciseBlock key={ex.id} ex={ex} workout={w} units={units} onReplace={() => router.push({ pathname: "/workout/exercise-picker", params: { replace: ex.id } })} onInfo={() => router.push({ pathname: "/workout/exercise-picker", params: { info: ex.exerciseId } })} />
        ))}
        <Button title={t("Add exercise")} kind="secondary" icon="add" onPress={() => router.push("/workout/exercise-picker")} />
        <Button title={t("Discard workout")} kind="ghost" onPress={() => confirm(t("Discard workout?"), t("Logged sets in this session will be removed."), t("Discard"), () => { discardWorkout(); router.back(); }, true)} />
      </ScrollView>
    </View>
  );
}
