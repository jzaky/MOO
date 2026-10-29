import { perServingToPer100, type NutrientValues } from "@moo/core";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { appendImage, compressForUpload } from "../../lib/images";
import { queryClient } from "../../lib/query";
import type { Food } from "../../lib/types";
import { Badge, Button, Card, Field, Row, Segmented, SectionHeader, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const FIELDS: { key: keyof NutrientValues; label: string; unit: string }[] = [
  { key: "energyKcal", label: "Energy", unit: "kcal" },
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "carbsG", label: "Carbohydrate", unit: "g" },
  { key: "sugarG", label: "of which sugars", unit: "g" },
  { key: "fatG", label: "Fat", unit: "g" },
  { key: "saturatedFatG", label: "of which saturated", unit: "g" },
  { key: "fiberG", label: "Fibre", unit: "g" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
];

export default function CustomFood() {
  const params = useLocalSearchParams<{ barcode?: string; label?: string; name?: string; correctId?: string }>();
  const [name, setName] = useState(params.name ?? "");
  const [brand, setBrand] = useState("");
  const [baseUnit, setBaseUnit] = useState<"g" | "ml">("g");
  const [basis, setBasis] = useState<"per_100" | "per_serving">("per_100");
  const [servingLabel, setServingLabel] = useState("");
  const [servingAmount, setServingAmount] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const correcting = !!params.correctId;

  useEffect(() => {
    if (!params.correctId) return;
    api<Food>(`/v1/foods/${params.correctId}`).then((f) => {
      setName(f.name);
      setBrand(f.brand ?? "");
      setBaseUnit(f.baseUnit);
      setValues(Object.fromEntries(Object.entries(f.per100).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, String(Math.round((v as number) * 100) / 100)])));
    });
  }, [params.correctId]);

  const scanLabel = async (fromCamera: boolean) => {
    setError(null);
    const pick = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (pick.canceled || !pick.assets[0]) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (params.barcode) form.append("barcode", params.barcode);
      await appendImage(form, "label", await compressForUpload(pick.assets[0].uri, 2000));
      const r = await api<{ draft: { name: string; brand: string | null; baseUnit: "g" | "ml"; per100: NutrientValues; servings: { label: string; baseAmount: number }[] }; unreadableFields: string[]; flags: string[] }>("/v1/ai/nutrition-label", { method: "POST", form });
      if (r.draft.name) setName(r.draft.name);
      if (r.draft.brand) setBrand(r.draft.brand);
      setBaseUnit(r.draft.baseUnit);
      setBasis("per_100");
      setValues(Object.fromEntries(Object.entries(r.draft.per100).map(([k, v]) => [k, String(Math.round((v as number) * 100) / 100)])));
      if (r.draft.servings[0]) {
        setServingLabel(r.draft.servings[0].label);
        setServingAmount(String(r.draft.servings[0].baseAmount));
      }
      setFlags([...r.flags, ...r.unreadableFields.map((u) => `unreadable:${u}`)]);
      haptic("success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't read the label.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.label === "1") void scanLabel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed: NutrientValues = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v.replace(",", ".")))).map(([k, v]) => [k, Number(v.replace(",", "."))]));
  const sAmt = Number(servingAmount);
  const per100 = basis === "per_100" ? parsed : sAmt > 0 ? perServingToPer100(parsed, sAmt) : null;
  const valid = !!name.trim() && per100 && typeof per100.energyKcal === "number";

  const save = async () => {
    if (!valid || !per100) return;
    setBusy(true);
    setError(null);
    try {
      const servings = sAmt > 0 ? [{ label: servingLabel.trim() || `${sAmt} ${baseUnit}`, baseAmount: sAmt }] : [];
      const food = correcting
        ? await api<Food>(`/v1/foods/${params.correctId}/corrections`, { body: { name: name.trim(), brand: brand.trim() || null, per100, ...(servings.length ? { servings } : {}), reason: "Edited in app" } })
        : await api<Food>("/v1/foods", { body: { name: name.trim(), brand: brand.trim() || null, barcode: params.barcode || null, baseUnit, per100, servings, source: flags.length || params.label ? "label" : "user" } });
      haptic("success");
      void queryClient.invalidateQueries({ queryKey: qk.food(food.id) });
      router.replace({ pathname: "/food/[id]", params: { id: food.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen close title={correcting ? "Correct food" : "New food"} subtitle={correcting ? "Saved as your private version. The shared record and past entries are unchanged." : "Saved privately to your account."} footer={<Button title="Save" onPress={() => void save()} loading={busy} disabled={!valid} />}>
      {!correcting ? (
        <Row gap={8}>
          <Button title="Scan label" icon="camera" kind="secondary" size="md" onPress={() => void scanLabel(true)} style={{ flex: 1 }} />
          <Button title="From photos" icon="photos" kind="secondary" size="md" onPress={() => void scanLabel(false)} style={{ flex: 1 }} />
        </Row>
      ) : null}
      {flags.length ? (
        <Card>
          <Stack gap={6}>
            <Row gap={8}><Badge label="Check before saving" tone="warning" /></Row>
            {flags.map((f) => <T key={f} variant="footnote" color="textSecondary">{f.startsWith("unreadable:") ? `Couldn't read: ${f.slice(11)}` : f === "per100_per_serving_mismatch" ? "Per-100 and per-serving values on the label don't agree." : f === "energy_macro_mismatch" ? "Calories don't match the macros; check the numbers." : f.replace(/_/g, " ")}</T>)}
          </Stack>
        </Card>
      ) : null}
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Laban up, low fat" />
      <Field label="Brand (optional)" value={brand} onChangeText={setBrand} />
      {params.barcode ? <T variant="footnote" color="textTertiary">Barcode {params.barcode}</T> : null}
      <Segmented options={[{ value: "g", label: "Solid (g)" }, { value: "ml", label: "Liquid (ml)" }]} value={baseUnit} onChange={setBaseUnit} />
      <SectionHeader title="Serving (optional)" />
      <Row gap={8}>
        <View style={{ flex: 2 }}><Field value={servingLabel} onChangeText={setServingLabel} placeholder="1 cup / 1 bar" accessibilityLabel="Serving name" /></View>
        <View style={{ flex: 1 }}><Field value={servingAmount} onChangeText={setServingAmount} keyboardType="decimal-pad" suffix={baseUnit} accessibilityLabel="Serving size" /></View>
      </Row>
      <SectionHeader title="Nutrition" />
      <Segmented options={[{ value: "per_100", label: `Per 100 ${baseUnit}` }, { value: "per_serving", label: "Per serving" }]} value={basis} onChange={setBasis} />
      {basis === "per_serving" && !(sAmt > 0) ? <T variant="footnote" color="warning">Enter the serving size to use per-serving values.</T> : null}
      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label} value={values[f.key] ?? ""} onChangeText={(v) => setValues((x) => ({ ...x, [f.key]: v }))} keyboardType="decimal-pad" suffix={f.unit} placeholder="Leave empty if unknown" />
      ))}
      <T variant="caption" color="textTertiary">Empty fields are stored as unknown, not zero.</T>
      {error ? <T variant="footnote" color="danger">{error}</T> : null}
    </Screen>
  );
}
