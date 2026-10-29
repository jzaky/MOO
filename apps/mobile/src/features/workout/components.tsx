import { kgToLb, lbToKg, platesToLoad, round, STANDARD_BARBELL, type UnitSystem } from "@stoke/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { fmtDay, t, tn } from "../../i18n";
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

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Display name for a muscle key from the exercise catalogue. */
export function muscleLabel(k: string): string {
  switch (k) {
    case "abductors": return t("Abductors");
    case "abs": return t("Abs");
    case "adductors": return t("Adductors");
    case "biceps": return t("Biceps");
    case "calves": return t("Calves");
    case "chest": return t("Chest");
    case "forearms": return t("Forearms");
    case "front_delts": return t("Front delts");
    case "glutes": return t("Glutes");
    case "hamstrings": return t("Hamstrings");
    case "hip_flexors": return t("Hip flexors");
    case "lats": return t("Lats");
    case "lower_back": return t("Lower back");
    case "obliques": return t("Obliques");
    case "quads": return t("Quads");
    case "rear_delts": return t("Rear delts");
    case "side_delts": return t("Side delts");
    case "traps": return t("Traps");
    case "triceps": return t("Triceps");
    case "upper_back": return t("Upper back");
    default: return pretty(k);
  }
}

/** Display name for an equipment key from the exercise catalogue. */
export function equipmentLabel(k: string): string {
  switch (k) {
    case "barbell": return t("Barbell");
    case "bodyweight": return t("Bodyweight");
    case "cable": return t("Cable");
    case "cardio_machine": return t("Cardio machine");
    case "dumbbell": return t("Dumbbell");
    case "kettlebell": return t("Kettlebell");
    case "machine": return t("Machine");
    case "pullup_bar": return t("Pull-up bar");
    case "smith_machine": return t("Smith machine");
    case "other": return t("Other");
    default: return pretty(k);
  }
}

/** One-letter tag shown in the set column for non-working sets. */
function kindShort(kind: SetKind): string {
  switch (kind) {
    case "warmup": return t("W");
    case "drop": return t("D");
    case "failure": return t("F");
    case "backoff": return t("B");
    default: return "";
  }
}

function kindName(kind: SetKind): string {
  switch (kind) {
    case "warmup": return t("warm-up");
    case "drop": return t("drop set");
    case "failure": return t("to failure");
    case "backoff": return t("back-off");
    default: return t("working");
  }
}

/** Label for a progression action from the engine. */
export function actionLabel(action: string): string {
  switch (action) {
    case "increase_load": return t("increase load");
    case "increase_reps": return t("increase reps");
    case "maintain": return t("repeat");
    case "reduce_load": return t("reduce load");
    case "deload": return t("deload");
    case "establish_baseline": return t("establish baseline");
    default: return action.replace(/_/g, " ");
  }
}

const KIND_CYCLE: SetKind[] = ["working", "warmup", "drop", "failure"];

function fmtLoad(kg: number, units: UnitSystem): string {
  const v = units === "imperial" ? round(kgToLb(kg), 1) : round(kg, 2);
  return Number.isInteger(v) ? String(v) : String(v);
}

function PlateCalculator({ ex, units }: { ex: ActiveExercise; units: UnitSystem }) {
  const th = useTheme();
  const target = ex.sets.find((s) => !s.completed && s.kind !== "warmup") ?? ex.sets.find((s) => !s.completed) ?? ex.sets.at(-1);
  const unit = units === "imperial" ? "lb" : "kg";
  const bar = STANDARD_BARBELL[unit];
  // Plates are counted in the unit the gym uses, so convert the logged weight first.
  const r = target && target.weightKg > 0 ? platesToLoad(bar, unit === "lb" ? round(kgToLb(target.weightKg), 1) : target.weightKg) : null;
  if (!r) return <T variant="footnote" color="textSecondary">{t("Enter a weight of at least the bar ({bar} {unit}) to see plates.", { bar: bar.barKg, unit })}</T>;
  return (
    <View accessibilityLabel={r.plates.length ? t("Each side: {plates} {unit}", { plates: r.plates.join(", "), unit }) : t("Each side: no plates")} style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: th.c.surfaceSunken }}>
      <Row justify="space-between">
        <T variant="footnote" color="textSecondary">{t("Each side, on a {bar} {unit} bar", { bar: bar.barKg, unit })}</T>
        <T variant="footnote" weight="600">{r.total} {unit}</T>
      </Row>
      <Row gap={6} wrap>
        {r.plates.length ? r.plates.map((p, i) => <Badge key={i} label={`${p}`} tone="info" />) : <T variant="footnote">{t("Just the bar")}</T>}
      </Row>
      {!r.exact ? <T variant="caption" color="warning">{t("Standard plates can't make exactly that; this is the closest.")}</T> : null}
    </View>
  );
}

export function SetRow({ ex, set, index, active, units }: { ex: ActiveExercise; set: ActiveSet; index: number; active: boolean; units: UnitSystem }) {
  const th = useTheme();
  const [w, setW] = useState(fmtLoad(set.weightKg, units));
  const [r, setR] = useState(String(set.reps));
  const [menu, setMenu] = useState(false);
  useEffect(() => setW(fmtLoad(set.weightKg, units)), [set.weightKg, units]);
  useEffect(() => setR(String(set.reps)), [set.reps]);
  const workingIndex = ex.sets.slice(0, index + 1).filter((s) => s.kind !== "warmup").length;
  const label = set.kind === "working" ? String(workingIndex) : kindShort(set.kind);
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
      <Pressable accessibilityRole="button" accessibilityLabel={t("Set {set}, {kind}. Tap to change, hold for options", { set: label || index + 1, kind: kindName(set.kind) })} onPress={() => { const next = KIND_CYCLE[(KIND_CYCLE.indexOf(set.kind) + 1) % KIND_CYCLE.length]!; updateSet(ex.id, set.id, { kind: next }); haptic("selection"); }} onLongPress={() => setMenu(true)} style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: set.kind === "working" ? th.c.surfaceRaised : th.c.accentMuted }}>
        <T variant="footnote" weight="700" color={set.kind === "working" ? "textSecondary" : "accent"}>{label}</T>
      </Pressable>
      <T variant="caption" color="textTertiary" style={{ width: 54 }} numberOfLines={1}>
        {prev ? `${fmtLoad(prev.weightKg, units)}×${prev.reps}` : "—"}
      </T>
      <TextInput value={w} onChangeText={setW} onEndEditing={commitW} onBlur={commitW} keyboardType="decimal-pad" selectTextOnFocus editable={!set.completed} accessibilityLabel={units === "imperial" ? t("Weight in pounds for set {set}", { set: index + 1 }) : t("Weight in kilograms for set {set}", { set: index + 1 })} style={cell} />
      <TextInput value={r} onChangeText={setR} onEndEditing={commitR} onBlur={commitR} keyboardType="number-pad" selectTextOnFocus editable={!set.completed} accessibilityLabel={t("Reps for set {set}", { set: index + 1 })} style={cell} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.completed }}
        accessibilityLabel={t("Complete set {set}", { set: index + 1 })}
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
        title={t("Set {set}", { set: index + 1 })}
        onClose={() => setMenu(false)}
        actions={[
          { label: t("Warm-up set"), onPress: () => updateSet(ex.id, set.id, { kind: "warmup" }) },
          { label: t("Working set"), onPress: () => updateSet(ex.id, set.id, { kind: "working" }) },
          { label: t("Drop set"), onPress: () => updateSet(ex.id, set.id, { kind: "drop" }) },
          { label: t("To failure"), onPress: () => updateSet(ex.id, set.id, { kind: "failure", rir: 0 }) },
          ...[3, 2, 1, 0].map((rir) => ({ label: tn(rir, "{n} rep in reserve", "{n} reps in reserve"), onPress: () => updateSet(ex.id, set.id, { rir }) })),
          { label: t("Delete set"), icon: "trash" as const, destructive: true, onPress: () => removeSet(ex.id, set.id) },
        ]}
      />
    </View>
  );
}

export function ExerciseBlock({ ex, workout, units, onReplace, onInfo }: { ex: ActiveExercise; workout: ActiveWorkout; units: UnitSystem; onReplace: () => void; onInfo: () => void }) {
  const [menu, setMenu] = useState(false);
  const [plates, setPlates] = useState(false);
  const barbell = ex.exercise.loadProfile === "barbell";
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
              {ex.prescription ? `${ex.prescription.sets} × ${ex.prescription.repRange.min}${ex.prescription.repRange.max !== ex.prescription.repRange.min ? `–${ex.prescription.repRange.max}` : ""} · ${t("rest {m} min", { m: Math.round((ex.prescription.restSec ?? 120) / 60 * 10) / 10 })}` : t("Free logging")}
              {ex.previous ? ` · ${t("last {date}", { date: fmtDay(ex.previous.day) })}` : ""}
            </T>
          </Pressable>
          <Row gap={4}>
            <Badge label={`${done}/${ex.sets.filter((s) => s.kind !== "warmup").length}`} />
            <IconButton icon="more" label={t("{name} options", { name: ex.exercise.name })} onPress={() => setMenu(true)} size={34} />
          </Row>
        </Row>
        {rec && rec.action !== "establish_baseline" ? (
          <View style={{ gap: 6 }}>
            <T variant="footnote" color="textSecondary">{rec.reasons.at(-1)}</T>
            {needsConfirm ? (
              <Button title={t("Use suggestion: {load} {unit} × {reps}", { load: rec.targetLoadKg != null ? fmtLoad(rec.targetLoadKg, units) : "–", unit, reps: rec.targetReps[0] ?? "–" })} kind="secondary" size="sm" icon={rec.action === "increase_load" ? "up" : "down"} onPress={() => applySuggestion(ex.id)} />
            ) : null}
          </View>
        ) : rec?.action === "establish_baseline" ? (
          <T variant="footnote" color="textSecondary">{t("First time: pick a weight you could lift for a few more reps than the target.")}</T>
        ) : null}
        <Row gap={8} style={{ paddingHorizontal: 2 }}>
          <T variant="caption" color="textTertiary" style={{ width: 34, textAlign: "center" }}>{t("Set")}</T>
          <T variant="caption" color="textTertiary" style={{ width: 54 }}>{t("Previous")}</T>
          <T variant="caption" color="textTertiary" style={{ flex: 1, textAlign: "center" }}>{unit}</T>
          <T variant="caption" color="textTertiary" style={{ flex: 1, textAlign: "center" }}>{t("Reps")}</T>
          <View style={{ width: 44 }} />
        </Row>
        {ex.sets.map((s, i) => <SetRow key={s.id} ex={ex} set={s} index={i} active={next?.s === s.id} units={units} />)}
        {plates ? <PlateCalculator ex={ex} units={units} /> : null}
        <Row gap={8}>
          <Button title={t("Add set")} kind="ghost" size="sm" icon="add" onPress={() => addSet(ex.id)} style={{ flex: 1 }} />
          {barbell ? <Button title={plates ? t("Hide plates") : t("Plates")} kind="ghost" size="sm" onPress={() => setPlates((v) => !v)} style={{ flex: 1 }} /> : null}
        </Row>
      </Stack>
      <ActionSheet
        visible={menu}
        title={ex.exercise.name}
        onClose={() => setMenu(false)}
        actions={[
          { label: t("Add warm-up set"), onPress: () => addSet(ex.id, "warmup") },
          { label: t("Add drop set"), onPress: () => addSet(ex.id, "drop") },
          { label: t("Replace exercise"), icon: "sync", onPress: onReplace },
          { label: t("Exercise details"), icon: "info", onPress: onInfo },
          { label: t("Remove exercise"), icon: "trash", destructive: true, onPress: () => removeExercise(ex.id) },
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
    <View accessibilityLiveRegion="polite" accessibilityLabel={left ? tn(left, "Rest: {n} second left", "Rest: {n} seconds left") : t("Rest over")} style={{ backgroundColor: th.c.surfaceRaised, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1, borderColor: th.c.border }}>
      <Row justify="space-between">
        <Row gap={8}>
          <Icon name="timer" size={18} color={left ? "accent" : "warning"} />
          <T variant="metric">{left ? formatDuration(left) : t("Go")}</T>
        </Row>
        <Row gap={6}>
          <Button title="−15" kind="secondary" size="sm" onPress={() => adjustRest(-15)} />
          <Button title="+15" kind="secondary" size="sm" onPress={() => adjustRest(15)} />
          <Button title={t("Skip")} kind="ghost" size="sm" onPress={skipRest} />
        </Row>
      </Row>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: th.c.track }}>
        <View style={{ height: 4, borderRadius: 2, width: `${frac * 100}%`, backgroundColor: th.c.accent }} />
      </View>
    </View>
  );
}
