import { kgToLb, lbToKg, platesToLoad, round, STANDARD_BARBELL, type UnitSystem } from "@stoke/core";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, TextInput, View, type TextStyle } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { t, tn } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { Button, Icon, Row, Stack, T } from "../../ui/primitives";
import { formatDuration, useNow } from "./components";
import { focusPosition, previousFor, recordFor, weightStep } from "./focus";
import { adjustRest, skipRest, toggleSetComplete, updateSet, type ActiveWorkout } from "./store";

const toUnit = (kg: number, units: UnitSystem) => (units === "imperial" ? round(kgToLb(kg), 1) : round(kg, 2));
const fromUnit = (v: number, units: UnitSystem) => (units === "imperial" ? lbToKg(v) : v);
const fmt = (v: number) => String(Number.isInteger(v) ? v : round(v, 2));

/** Plate colours by size rank (largest first), loosely following competition colours. */
const PLATE_COLORS = ["#EF3B55", "#4F7FE0", "#FFD23F", "#3CC47A", "#F2EFE9", "#EF3B55", "#9AA0A6", "#9AA0A6"];

function Barbell({ totalKg, units }: { totalKg: number; units: UnitSystem }) {
  const th = useTheme();
  const unit = units === "imperial" ? "lb" : "kg";
  const bar = STANDARD_BARBELL[unit];
  const r = platesToLoad(bar, toUnit(totalKg, units));
  if (!r) return <T variant="mono" color="textTertiary" align="center">{t("Below the bar's weight ({bar} {unit})", { bar: bar.barKg, unit })}</T>;
  const sizes: number[] = [...bar.platePairsKg].sort((a, b) => b - a);
  const plate = (p: number, i: number) => {
    const rank = Math.max(0, sizes.indexOf(p));
    const h = 52 - rank * 6;
    return <View key={`${p}-${i}`} style={{ width: rank < 4 ? 9 : 6, height: Math.max(18, h), borderRadius: 3, backgroundColor: PLATE_COLORS[rank] ?? th.c.textTertiary }} />;
  };
  return (
    <View accessible accessibilityLabel={r.plates.length ? t("Each side: {plates} {unit}", { plates: r.plates.join(", "), unit }) : t("Each side: no plates")} style={{ gap: 6, alignItems: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 56, direction: "ltr" }}>
        {[...r.plates].reverse().map(plate)}
        <View style={{ width: 14, height: 10, backgroundColor: "#8F8A82" }} />
        <View style={{ width: 70, height: 6, borderRadius: 3, backgroundColor: "#8F8A82" }} />
        <View style={{ width: 14, height: 10, backgroundColor: "#8F8A82" }} />
        {r.plates.map(plate)}
      </View>
      <T variant="mono" color="textTertiary">
        {r.plates.length ? t("Each side: {plates} {unit}", { plates: r.plates.join(" + "), unit }) : t("Just the bar")}
        {!r.exact ? ` · ${t("closest possible")}` : ""}
      </T>
    </View>
  );
}

function Dial({ label, value, onChange, step, onCommitText, accessibilityLabel }: { label: string; value: number; onChange: (v: number) => void; step: number; onCommitText: (text: string) => void; accessibilityLabel: string }) {
  const th = useTheme();
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : fmt(value);
  const btn = (delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))} ${label}`}
      onPress={() => {
        haptic("selection");
        onChange(Math.max(0, round(value + delta, 2)));
      }}
      hitSlop={6}
      style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? th.c.surfacePressed : th.c.surfaceRaised })}
    >
      <Icon name={delta > 0 ? "add" : "minus"} size={18} color="text" />
    </Pressable>
  );
  const input: TextStyle = { ...th.type.metricHero, color: th.c.text, textAlign: "center", minWidth: 0, width: "100%", padding: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null) };
  return (
    <View style={{ flex: 1, backgroundColor: th.c.surfaceSunken, borderRadius: 20, borderWidth: 1, borderColor: th.c.border, paddingVertical: 10, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", direction: "ltr" }}>
      {btn(-step)}
      <View style={{ flex: 1, alignItems: "center" }}>
        <TextInput
          value={shown}
          onFocus={() => {
            setText(fmt(value));
            setEditing(true);
          }}
          onChangeText={setText}
          onBlur={() => {
            setEditing(false);
            onCommitText(text);
          }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={accessibilityLabel}
          style={input}
        />
        <T variant="label" color="textTertiary" style={{ fontSize: 9 }}>{label}</T>
      </View>
      {btn(step)}
    </View>
  );
}

function RestCard({ rest, next }: { rest: NonNullable<ActiveWorkout["rest"]>; next: string | null }) {
  const th = useTheme();
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  const frac = Math.min(1, Math.max(0, 1 - (rest.endsAt - now) / (rest.durationSec * 1000)));
  const size = 64, r = 26, circ = 2 * Math.PI * r;
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={left ? tn(left, "Rest: {n} second left", "Rest: {n} seconds left") : t("Rest over")} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: th.c.border, backgroundColor: th.c.surface }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={th.c.track} strokeWidth={7} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={left ? th.c.data : th.c.success} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={`${circ * frac} ${circ}`} />
        </G>
      </Svg>
      <Stack gap={0} style={{ flex: 1 }}>
        <T variant="label" color="data" style={{ fontSize: 10 }}>{left ? t("Rest") : t("Rest over")}</T>
        <T variant="metricL">{left ? formatDuration(left) : t("Go")}</T>
        {next ? <T variant="caption" color="textSecondary" numberOfLines={1}>{t("Next: {what}", { what: next })}</T> : null}
      </Stack>
      <Stack gap={6}>
        <Row gap={6}>
          <Button title="−15" kind="secondary" size="sm" onPress={() => adjustRest(-15)} />
          <Button title="+15" kind="secondary" size="sm" onPress={() => adjustRest(15)} />
        </Row>
        <Button title={t("Skip")} kind="ghost" size="sm" onPress={skipRest} />
      </Stack>
    </View>
  );
}

function RecordToast({ record, unit, onDone }: { record: { name: string; e1rm: number; gain: number } | null; unit: string; onDone: () => void }) {
  const [y] = useState(() => new Animated.Value(-160));
  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) y.setValue(0);
      else Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== "web", friction: 6, tension: 80 }).start();
      AccessibilityInfo.announceForAccessibility(t("New personal record"));
    });
    const id = setTimeout(() => {
      Animated.timing(y, { toValue: -160, duration: 250, useNativeDriver: Platform.OS !== "web" }).start(onDone);
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [record, y, onDone]);
  if (!record) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 8, left: 12, right: 12, zIndex: 20, transform: [{ translateY: y }] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, backgroundColor: "#FFB347", backgroundImage: "linear-gradient(100deg, #FFD27A, #FF8A3D)" } as never}>
        <Icon name="trophy" size={24} color="#2A1104" />
        <Stack gap={0} style={{ flex: 1 }}>
          <T variant="headline" weight="800" style={{ color: "#2A1104" }}>{t("New personal record")}</T>
          <T variant="footnote" weight="600" style={{ color: "#2A1104" }}>{t("{name} · estimated 1RM {e1rm} {unit} (+{gain})", { name: record.name, e1rm: fmt(record.e1rm), unit, gain: fmt(record.gain) })}</T>
        </Stack>
      </View>
    </Animated.View>
  );
}

/**
 * Focus mode: one set at a time. Big weight and rep dials, the plates drawn on the bar,
 * last time vs today's aim, a rest ring with what's next, and a record cue when a set
 * beats the best estimated 1RM on record. Everything writes to the same workout store
 * as the list view.
 */
export function FocusView({ w, units, onFinish }: { w: ActiveWorkout; units: UnitSystem; onFinish: () => void }) {
  const th = useTheme();
  const pos = focusPosition(w);
  const [record, setRecord] = useState<{ name: string; e1rm: number; gain: number } | null>(null);
  const unit = units === "imperial" ? "lb" : "kg";

  if (!pos) {
    return (
      <Stack gap={14} style={{ paddingTop: 24, alignItems: "center" }}>
        <Icon name="check" size={40} color="data" />
        <T variant="title2" align="center">{t("Every set is done")}</T>
        <T variant="subhead" color="textSecondary" align="center">{t("Finish to save the workout and see your records.")}</T>
        <Button title={t("Finish workout")} onPress={onFinish} style={{ alignSelf: "stretch" }} />
      </Stack>
    );
  }

  const { exercise: ex, set, workingNumber, workingTotal, exerciseIndex } = pos;
  const step = weightStep(ex, units);
  const prev = previousFor(ex, workingNumber);
  const aimKg = set.targetWeightKg ?? null;
  const aimReps = set.targetReps ?? null;
  // While resting, the set on screen is already the next one.
  const restingNext = w.rest ? `${ex.exercise.name} ${fmt(toUnit(set.weightKg, units))} × ${set.reps}` : null;
  const working = ex.sets.filter((s) => s.kind !== "warmup");

  const done = () => {
    const rec = recordFor(ex, set);
    toggleSetComplete(ex.id, set.id);
    if (rec) {
      haptic("pr");
      setRecord({ name: ex.exercise.name, e1rm: round(toUnit(rec.e1rmKg, units), 1), gain: round(toUnit(rec.e1rmKg, units) - toUnit(rec.previousKg, units), 1) });
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <RecordToast record={record} unit={unit} onDone={() => setRecord(null)} />
      <Row justify="space-between">
        <T variant="label" color="textTertiary">
          {t("Exercise {i} of {n}", { i: exerciseIndex + 1, n: w.exercises.length })}
        </T>
        <T variant="label" color={set.kind === "warmup" ? "warning" : "accent"}>
          {set.kind === "warmup" ? t("Warm-up") : t("Set {i} of {n}", { i: workingNumber, n: workingTotal })}
        </T>
      </Row>

      <View style={{ borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,106,43,0.28)", padding: 16, gap: 14, backgroundColor: th.c.surface, backgroundImage: "linear-gradient(170deg, rgba(255,106,43,0.14), rgba(17,19,21,0) 60%)" } as never}>
        <Stack gap={4}>
          <T variant="display" numberOfLines={2} style={{ fontSize: 34, lineHeight: 36 }}>{ex.exercise.name}</T>
          <T variant="mono" color="textSecondary">
            {[prev ? t("Last {w} × {r}", { w: `${fmt(toUnit(prev.weightKg, units))}`, r: prev.reps }) : t("First time on record"), aimKg != null && aimReps != null ? t("aim {w} × {r}", { w: fmt(toUnit(aimKg, units)), r: aimReps }) : null].filter(Boolean).join(" · ")}
          </T>
          {ex.recommendation && ex.recommendation.action !== "establish_baseline" && workingNumber === 1 ? <T variant="caption" color="textTertiary">{ex.recommendation.reasons.at(-1)}</T> : null}
        </Stack>

        <Row gap={10}>
          <Dial
            label={unit.toUpperCase()}
            value={toUnit(set.weightKg, units)}
            step={step}
            onChange={(v) => updateSet(ex.id, set.id, { weightKg: fromUnit(v, units) })}
            onCommitText={(s) => {
              const v = Number(s.replace(",", "."));
              if (Number.isFinite(v) && v >= 0) updateSet(ex.id, set.id, { weightKg: fromUnit(v, units) });
            }}
            accessibilityLabel={units === "imperial" ? t("Weight in pounds") : t("Weight in kilograms")}
          />
          <Dial
            label={t("Reps")}
            value={set.reps}
            step={1}
            onChange={(v) => updateSet(ex.id, set.id, { reps: Math.round(v) })}
            onCommitText={(s) => {
              const v = parseInt(s, 10);
              if (Number.isFinite(v) && v >= 0) updateSet(ex.id, set.id, { reps: v });
            }}
            accessibilityLabel={t("Reps")}
          />
        </Row>

        {ex.exercise.loadProfile === "barbell" ? <Barbell totalKg={set.weightKg} units={units} /> : null}

        <Row gap={6} style={{ direction: "ltr" }}>
          {working.map((s) => (
            <View key={s.id} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: s.completed ? th.c.accent : s.id === set.id ? th.c.accentMuted : th.c.track }} />
          ))}
        </Row>
      </View>

      <Button title={t("Set done")} icon="check" onPress={done} accessibilityLabel={t("Complete set: {w} {unit} × {r}", { w: fmt(toUnit(set.weightKg, units)), unit, r: set.reps })} />
      {w.rest ? <RestCard rest={w.rest} next={restingNext} /> : null}
    </View>
  );
}
