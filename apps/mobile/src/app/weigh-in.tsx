import { lbToKg, toCm } from "@stoke/core";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { logMeasurement, logWeight, useProfile } from "../lib/data";
import { haptic } from "../lib/haptics";
import { todayKey } from "../lib/ids";
import { Button, Field, Row, SectionHeader, T } from "../ui/primitives";
import { Screen } from "../ui/Screen";

const SITES = [
  ["waist", "Waist"],
  ["neck", "Neck"],
  ["hips", "Hips"],
  ["chest", "Chest"],
  ["left_arm", "Arm (left)"],
  ["right_arm", "Arm (right)"],
  ["left_thigh", "Thigh (left)"],
] as const;

export default function WeighIn() {
  const params = useLocalSearchParams<{ measurements?: string }>();
  const units = useProfile().data?.unitSystem ?? "metric";
  const [weight, setWeight] = useState("");
  const [m, setM] = useState<Record<string, string>>({});
  const showM = params.measurements === "1";
  const wNum = Number(weight.replace(",", "."));
  const valid = (weight ? wNum > 0 : false) || Object.values(m).some((v) => Number(v) > 0);
  const save = () => {
    const day = todayKey();
    if (wNum > 0) logWeight(day, units === "imperial" ? lbToKg(wNum) : wNum, { value: wNum, unit: units === "imperial" ? "lb" : "kg" });
    for (const [kind, v] of Object.entries(m)) {
      const n = Number(v.replace(",", "."));
      if (n > 0) logMeasurement(day, kind, units === "imperial" ? toCm(n, "in") : n, { value: n, unit: units === "imperial" ? "in" : "cm" });
    }
    haptic("success");
    router.back();
  };
  return (
    <Screen close title={showM ? "Measurements" : "Weigh-in"} footer={<Button title="Save" onPress={save} disabled={!valid} />}>
      {!showM ? (
        <>
          <Field label="Body weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix={units === "imperial" ? "lb" : "kg"} autoFocus placeholder="0.0" />
          <T variant="footnote" color="textSecondary">For comparable readings, weigh in the morning after using the bathroom and before eating. Single readings move with water and food; the trend is what matters.</T>
        </>
      ) : null}
      <SectionHeader title={showM ? "Circumferences" : "Measurements (optional)"} />
      {SITES.map(([k, l]) => (
        <View key={k}>
          <Field label={l} value={m[k] ?? ""} onChangeText={(v) => setM((x) => ({ ...x, [k]: v }))} keyboardType="decimal-pad" suffix={units === "imperial" ? "in" : "cm"} />
        </View>
      ))}
      <Row><T variant="caption" color="textTertiary">Saved offline if needed and synced automatically.</T></Row>
    </Screen>
  );
}
