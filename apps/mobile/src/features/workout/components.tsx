import { kgToLb, lbToKg, round, type UnitSystem } from "@stoke/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { ActionSheet } from "../../ui/ActionSheet";
import { Badge, Button, Card, Icon, IconButton, Row, Stack, T } from "../../ui/primitives";
import { addSet, adjustRest, applySuggestion, changesLoad, removeExercise, removeSet, skipRest, toggleSetComplete, updateSet, type ActiveExercise, type ActiveSet, type ActiveWorkout, type SetKind } from "./store";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const KIND_LABEL: Record<SetKind, string> = { warmup: "W", working: "", drop: "D", failure: "F", backoff: "B" };
const KIND_CYCLE: SetKind[] = ["working", "warmup", "drop", "failure"];

function fmtLoad(kg: number, units: UnitSystem): string {
  const v = units === "imperial" ? round(kgToLb(kg), 1) : round(kg, 2);
  return Number.isInteger(v) ? String(v) : String(v);
}

export function SetRow({ ex, set, index, active, units }: { ex: ActiveExercise; set: ActiveSet; index: number; active: boolean; units: UnitSystem }) {
  const th = useTheme();
  const [w, setW] = useState(fmtLoad(set.weightKg, units));
  const [r, setR] = useState(String(set.reps));
  const [menu, setMenu] = useState(false);
  useEffect(() => setW(fmtLoad(set.weightKg, units)), [set.weightKg, units]);
  useEffect(() => setR(String(set.reps)), [set.reps]);
  const workingIndex = ex.sets.slice(0, index + 1).filter((s) => s.kind !== "warmup").length;
  const label = set.kind === "working" ? String(workingIndex) : KIND_LABEL[set.kind];
  const commitW = () => {
    const n = Number(w.replace(",", "."));
    if (Number.isFinite(n)) updateSet(ex.id, set.id, { weightKg: units === "imperial" ? lbToKg(n) : n });
  };
  const commitR = () => {
    const n = parseInt(r, 10);
    if (Number.isFinite(n) && n >= 0) updateSet(ex.id, set.id, { reps: n });
  };
  const cell = { flex: 1, flexBasis: 0, minWidth: 0, outlineWidth: 0, height: 44, borderRadius: 10, backgroundColor: set.completed ? "transparent" : th.c.surfaceSunken, borderWidth: 1, borderColor: active && !set.completed ? th.c.accent : th.c.border, color: th.c.text, textAlign: "center" as const, ...th.type.metricS };
  const prev = ex.previous?.sets.filter((s) => s.kind !== "warmup")[workingIndex - 1];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, opacity: set.completed ? 0.75 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Set ${label || index + 1} type ${set.kind}. Tap to change, hold for options`} onPress={() => { const next = KIND_CYCLE[(KIND_CYCLE.indexOf(set.kind) + 1) % KIND_CYCLE.length]!; updateSet(ex.id, set.id, { kind: next }); haptic("selection"); }} onLongPress={() => setMenu(true)} style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: set.kind === "working" ? th.c.surfaceRaised : th.c.accentMuted }}>
        <T variant="footnote" weight="700" color={set.kind === "working" ? "textSecondary" : "accent"}>{label}</T>
      </Pressable>
      <T variant="caption" color="textTertiary" style={{ width: 54 }} numberOfLines={1}>
        {prev ? `${fmtLoad(prev.weightKg, units)}×${prev.reps}` : "—"}
      </T>
      <TextInput value={w} onChangeText={setW} onEndEditing={commitW} onBlur={commitW} keyboardType="decimal-pad" selectTextOnFocus editable={!set.completed} accessibilityLabel={`Weight in ${units === "imperial" ? "pounds" : "kilograms"} for set ${index + 1}`} style={cell} />
      <TextInput value={r} onChangeText={setR} onEndEditing={commitR} onBlur={commitR} keyboardType="number-pad" selectTextOnFocus editable={!set.completed} accessibilityLabel={`Reps for set ${index + 1}`} style={cell} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.completed }}
        accessibilityLabel={`Complete set ${index + 1}`}
        onPress={() => {
          commitW();
          commitR();
          toggleSetComplete(ex.id, set.id);
        }}
        hitSlop={6}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: set.completed ? th.c.accent : pressed ? th.c.surfacePressed : th.c.surfaceRaised, borderWidth: 1, borderColor: set.completed ? th.c.accent : th.c.border })}
      >
        <Icon name="check" size={20} color={set.completed ? "textInverse" : "textTertiary"} />
      </Pressable>
      <ActionSheet
        visible={menu}
        title={`Set ${index + 1}`}
        onClose={() => setMenu(false)}
        actions={[
          { label: "Warm-up set", onPress: () => updateSet(ex.id, set.id, { kind: "warmup" }) },
          { label: "Working set", onPress: () => updateSet(ex.id, set.id, { kind: "working" }) },
          { label: "Drop set", onPress: () => updateSet(ex.id, set.id, { kind: "drop" }) },
          { label: "To failure", onPress: () => updateSet(ex.id, set.id, { kind: "failure", rir: 0 }) },
          ...[3, 2, 1, 0].map((rir) => ({ label: `${rir} reps in reserve`, onPress: () => updateSet(ex.id, set.id, { rir }) })),
          { label: "Delete set", icon: "trash" as const, destructive: true, onPress: () => removeSet(ex.id, set.id) },
        ]}
      />
    </View>
  );
}

export function ExerciseBlock({ ex, workout, units, onReplace, onInfo }: { ex: ActiveExercise; workout: ActiveWorkout; units: UnitSystem; onReplace: () => void; onInfo: () => void }) {
  const [menu, setMenu] = useState(false);
  const next = workout.exercises.flatMap((e) => e.sets.map((s) => ({ e: e.id, s: s.id, done: s.completed }))).find((x) => !x.done);
  const rec = ex.recommendation;
  const unit = units === "imperial" ? "lb" : "kg";
  const needsConfirm = changesLoad(rec, ex.previous) && !ex.suggestionApplied;
  const done = ex.sets.filter((s) => s.completed && s.kind !== "warmup").length;
  return (
    <Card>
      <Stack gap={8}>
        <Row justify="space-between" align="flex-start">
          <Pressable accessibilityRole="button" onPress={onInfo} style={{ flex: 1, gap: 2 }}>
            <T variant="headline">{ex.exercise.name}</T>
            <T variant="caption" color="textTertiary">
              {ex.prescription ? `${ex.prescription.sets} × ${ex.prescription.repRange.min}${ex.prescription.repRange.max !== ex.prescription.repRange.min ? `–${ex.prescription.repRange.max}` : ""} · rest ${Math.round((ex.prescription.restSec ?? 120) / 60 * 10) / 10} min` : "Free logging"}
              {ex.previous ? ` · last ${new Date(`${ex.previous.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}
            </T>
          </Pressable>
          <Row gap={4}>
            <Badge label={`${done}/${ex.sets.filter((s) => s.kind !== "warmup").length}`} />
            <IconButton icon="more" label={`${ex.exercise.name} options`} onPress={() => setMenu(true)} size={34} />
          </Row>
        </Row>
        {rec && rec.action !== "establish_baseline" ? (
          <View style={{ gap: 6 }}>
            <T variant="footnote" color="textSecondary">{rec.reasons.at(-1)}</T>
            {needsConfirm ? (
              <Button title={`Use suggestion: ${rec.targetLoadKg != null ? fmtLoad(rec.targetLoadKg, units) : "–"} ${unit} × ${rec.targetReps[0] ?? "–"}`} kind="secondary" size="sm" icon={rec.action === "increase_load" ? "up" : "down"} onPress={() => applySuggestion(ex.id)} />
            ) : null}
          </View>
        ) : rec?.action === "establish_baseline" ? (
          <T variant="footnote" color="textSecondary">First time: pick a weight you could lift for a few more reps than the target.</T>
        ) : null}
        <Row gap={8} style={{ paddingHorizontal: 2 }}>
          <T variant="caption" color="textTertiary" style={{ width: 34, textAlign: "center" }}>Set</T>
          <T variant="caption" color="textTertiary" style={{ width: 54 }}>Previous</T>
          <T variant="caption" color="textTertiary" style={{ flex: 1, textAlign: "center" }}>{unit}</T>
          <T variant="caption" color="textTertiary" style={{ flex: 1, textAlign: "center" }}>Reps</T>
          <View style={{ width: 44 }} />
        </Row>
        {ex.sets.map((s, i) => <SetRow key={s.id} ex={ex} set={s} index={i} active={next?.s === s.id} units={units} />)}
        <Button title="Add set" kind="ghost" size="sm" icon="add" onPress={() => addSet(ex.id)} />
      </Stack>
      <ActionSheet
        visible={menu}
        title={ex.exercise.name}
        onClose={() => setMenu(false)}
        actions={[
          { label: "Add warm-up set", onPress: () => addSet(ex.id, "warmup") },
          { label: "Add drop set", onPress: () => addSet(ex.id, "drop") },
          { label: "Replace exercise", icon: "sync", onPress: onReplace },
          { label: "Exercise details", icon: "info", onPress: onInfo },
          { label: "Remove exercise", icon: "trash", destructive: true, onPress: () => removeExercise(ex.id) },
        ]}
      />
    </Card>
  );
}

export function RestTimer({ rest }: { rest: NonNullable<ActiveWorkout["rest"]> }) {
  const th = useTheme();
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      haptic("warning");
    }
    if (left > 0) fired.current = false;
  }, [left]);
  const frac = Math.min(1, Math.max(0, 1 - (rest.endsAt - now) / (rest.durationSec * 1000)));
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={left ? `Rest: ${left} seconds left` : "Rest over"} style={{ backgroundColor: th.c.surfaceRaised, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1, borderColor: th.c.border }}>
      <Row justify="space-between">
        <Row gap={8}>
          <Icon name="timer" size={18} color={left ? "accent" : "warning"} />
          <T variant="metric">{left ? formatDuration(left) : "Go"}</T>
        </Row>
        <Row gap={6}>
          <Button title="−15" kind="secondary" size="sm" onPress={() => adjustRest(-15)} />
          <Button title="+15" kind="secondary" size="sm" onPress={() => adjustRest(15)} />
          <Button title="Skip" kind="ghost" size="sm" onPress={skipRest} />
        </Row>
      </Row>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: th.c.track }}>
        <View style={{ height: 4, borderRadius: 2, width: `${frac * 100}%`, backgroundColor: th.c.accent }} />
      </View>
    </View>
  );
}
