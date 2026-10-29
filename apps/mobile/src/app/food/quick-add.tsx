import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { defaultMealForNow, quickAdd } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { Button, Chip, Field, Row, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

/** Log known numbers directly (e.g. from a restaurant's published nutrition). */
export default function QuickAdd() {
  const params = useLocalSearchParams<{ day?: string }>();
  const [desc, setDesc] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  const [f, setF] = useState("");
  const [meal, setMeal] = useState(defaultMealForNow());
  const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  const ok = !!desc.trim() && (num(kcal) ?? 0) > 0;
  return (
    <Screen close title="Quick add" footer={<Button title="Add" disabled={!ok} onPress={() => { quickAdd({ day: params.day ?? todayKey(), meal, description: desc.trim(), energyKcal: num(kcal)!, proteinG: num(p), carbsG: num(c), fatG: num(f) }); haptic("success"); router.back(); }} />}>
      <Field label="What was it?" value={desc} onChangeText={setDesc} placeholder="Restaurant chicken bowl" autoFocus />
      <Field label="Energy" value={kcal} onChangeText={setKcal} keyboardType="number-pad" suffix="kcal" />
      <Row gap={8}>
        <View style={{ flex: 1 }}><Field label="Protein" value={p} onChangeText={setP} keyboardType="decimal-pad" suffix="g" /></View>
        <View style={{ flex: 1 }}><Field label="Carbs" value={c} onChangeText={setC} keyboardType="decimal-pad" suffix="g" /></View>
        <View style={{ flex: 1 }}><Field label="Fat" value={f} onChangeText={setF} keyboardType="decimal-pad" suffix="g" /></View>
      </Row>
      <Row gap={8} wrap>
        {["breakfast", "lunch", "dinner", "snacks"].map((m) => <Chip key={m} label={m[0]!.toUpperCase() + m.slice(1)} selected={meal === m} onPress={() => setMeal(m)} />)}
      </Row>
      <T variant="caption" color="textTertiary">Macros you leave empty are recorded as unknown.</T>
    </Screen>
  );
}
