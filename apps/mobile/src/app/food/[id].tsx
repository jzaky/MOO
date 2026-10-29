import type { PortionDto } from "@stoke/contracts";
import { isKnown, NUTRIENT_META, nutrientsForPortion, PortionError, type NutrientKey, type PortionInput } from "@stoke/core";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { defaultMealForNow, logFood, qk, useFavorites, useFood } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Chip, Divider, ErrorState, Field, IconButton, Row, SectionHeader, Skeleton, Stack, Stepper, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const FLAG_TEXT: Record<string, string> = {
  energy_macro_mismatch: "Energy doesn't match the macros; one of the values may be wrong.",
  missing_macros: "Some macronutrients are missing for this food.",
  energy_from_kj: "Calories were converted from kilojoules.",
  sodium_from_salt: "Sodium was calculated from salt.",
  serving_unit_mismatch: "The listed serving size didn't match the nutrition basis and was ignored.",
  per100_from_raw_weight: "Per-gram values use raw ingredient weight (no cooked weight given).",
  unmatched_ingredients: "Some recipe ingredients have no nutrition data.",
  user_corrected: "You corrected this food.",
};

const DETAIL_KEYS: NutrientKey[] = ["fiberG", "sugarG", "saturatedFatG", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "cholesterolMg"];

export default function FoodDetail() {
  const th = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string; day?: string; meal?: string; entryId?: string; grams?: string }>();
  const food = useFood(params.id);
  const favs = useFavorites();
  const f = food.data;
  const [servingId, setServingId] = useState<string | "base" | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [amount, setAmount] = useState<string>(params.grams ?? "100");
  const [meal, setMeal] = useState(params.meal ?? defaultMealForNow());
  const [showAll, setShowAll] = useState(false);
  const isFav = !!favs.data?.some((x) => x.id === params.id);

  const activeServing = servingId ?? (params.grams ? "base" : f?.servings.find((s) => s.isDefault)?.id ?? f?.servings[0]?.id ?? "base");
  const portion: PortionDto | null = useMemo(() => {
    if (!f) return null;
    if (activeServing === "base") {
      const n = Number(amount.replace(",", "."));
      return n > 0 ? { kind: "amount", quantity: n, unit: f.baseUnit } : null;
    }
    return qty > 0 ? { kind: "serving", servingId: activeServing, quantity: qty } : null;
  }, [f, activeServing, qty, amount]);

  const preview = useMemo(() => {
    if (!f || !portion) return null;
    try {
      return nutrientsForPortion({ baseUnit: f.baseUnit, per100: f.per100, servings: f.servings.map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount })), densityGPerMl: f.densityGPerMl }, portion as PortionInput);
    } catch (e) {
      return e instanceof PortionError ? null : null;
    }
  }, [f, portion]);

  const toggleFav = async () => {
    haptic("selection");
    await api(`/v1/foods/${params.id}/favorite`, { method: isFav ? "DELETE" : "PUT" }).catch(() => {});
    void qc.invalidateQueries({ queryKey: qk.favorites });
  };

  const submit = () => {
    if (!f || !portion) return;
    logFood({ food: f, portion, day: params.day ?? todayKey(), meal, ...(params.entryId ? { id: params.entryId } : {}) });
    haptic("success");
    router.dismissAll();
  };

  const v = (k: NutrientKey) => preview?.nutrients[k];
  const fmt = (k: NutrientKey) => (isKnown(v(k)) ? `${Math.round((v(k) as number) * 10) / 10} ${NUTRIENT_META[k].unit}` : "—");

  return (
    <Screen
      close
      title={f?.name ?? "Food"}
      subtitle={f?.brand ?? undefined}
      right={f ? <IconButton icon="star" label={isFav ? "Remove from favourites" : "Add to favourites"} color={isFav ? "warning" : "textTertiary"} onPress={() => void toggleFav()} /> : undefined}
      footer={f ? <Button title={params.entryId ? "Update entry" : `Add to ${meal}`} onPress={submit} disabled={!portion || !preview} /> : undefined}
    >
      {food.isPending ? (
        <Card>
          <Stack>
            <Skeleton height={40} />
            <Skeleton />
          </Stack>
        </Card>
      ) : food.isError || !f ? (
        <Card>
          <ErrorState error={food.error} onRetry={() => void food.refetch()} />
        </Card>
      ) : (
        <>
          <Card>
            <Stack gap={10}>
              <Row justify="space-between" align="flex-end">
                <View>
                  <T variant="metricL">{isKnown(v("energyKcal")) ? Math.round(v("energyKcal") as number) : "—"}</T>
                  <T variant="footnote" color="textSecondary">
                    kcal
                  </T>
                </View>
                <T variant="footnote" color="textTertiary">
                  {preview ? `${Math.round(preview.baseAmount)} ${f.baseUnit}` : ""}
                </T>
              </Row>
              <Row gap={10}>
                {(
                  [
                    ["proteinG", "Protein", th.c.protein],
                    ["carbsG", "Carbs", th.c.carbs],
                    ["fatG", "Fat", th.c.fat],
                  ] as const
                ).map(([k, l, c]) => (
                  <View key={k} style={{ flex: 1, gap: 4 }}>
                    <Row gap={6}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                      <T variant="footnote" color="textSecondary">
                        {l}
                      </T>
                    </Row>
                    <T variant="headline">{fmt(k)}</T>
                  </View>
                ))}
              </Row>
            </Stack>
          </Card>

          <SectionHeader title="Amount" />
          <Row gap={8} wrap>
            {f.servings.map((s) => (
              <Chip key={s.id} label={`${s.label}${s.label.includes(String(Math.round(s.baseAmount))) ? "" : ` (${Math.round(s.baseAmount)} ${f.baseUnit})`}`} selected={activeServing === s.id} onPress={() => setServingId(s.id)} />
            ))}
            <Chip label={f.baseUnit === "g" ? "Grams" : "Millilitres"} selected={activeServing === "base"} onPress={() => setServingId("base")} />
          </Row>
          {activeServing === "base" ? (
            <Field value={amount} onChangeText={setAmount} keyboardType="decimal-pad" suffix={f.baseUnit} selectTextOnFocus accessibilityLabel={`Amount in ${f.baseUnit}`} />
          ) : (
            <Stepper value={qty} onChange={setQty} step={0.5} min={0.25} max={50} label="Servings" format={(x) => `${x} serving${x === 1 ? "" : "s"}`} />
          )}

          <SectionHeader title="Meal" />
          <Row gap={8} wrap>
            {["breakfast", "lunch", "dinner", "snacks"].map((m) => (
              <Chip key={m} label={m[0]!.toUpperCase() + m.slice(1)} selected={meal === m} onPress={() => setMeal(m)} />
            ))}
          </Row>

          <SectionHeader title="Nutrition" action={showAll ? "Less" : "More"} onAction={() => setShowAll((x) => !x)} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {(showAll ? (Object.keys(NUTRIENT_META) as NutrientKey[]).filter((k) => !["energyKcal", "proteinG", "carbsG", "fatG"].includes(k)) : DETAIL_KEYS).map((k, i) => (
              <View key={k}>
                {i ? <Divider /> : null}
                <Row justify="space-between" style={{ paddingVertical: 11 }}>
                  <T variant="subhead" color="textSecondary">
                    {NUTRIENT_META[k].label}
                  </T>
                  <T variant="subhead">{fmt(k)}</T>
                </Row>
              </View>
            ))}
          </Card>
          <T variant="caption" color="textTertiary">
            “—” means the source has no value for that nutrient. It is never counted as zero.
          </T>

          <SectionHeader title="Source" />
          <Card>
            <Stack gap={8}>
              <Row gap={8} wrap>
                <Badge label={f.isPrivate ? "Your food" : f.source === "off" ? "Open Food Facts" : f.source === "usda" ? "USDA" : f.source} tone={f.isPrivate ? "accent" : "neutral"} />
                {f.completeness < 1 ? <Badge label="Incomplete" tone="warning" /> : null}
                {f.barcode ? <Badge label={f.barcode} /> : null}
              </Row>
              {f.quality.flags.map((fl) => (FLAG_TEXT[fl] ? <T key={fl} variant="footnote" color="textSecondary">{FLAG_TEXT[fl]}</T> : null))}
              {f.sourceLicense && !f.isPrivate ? (
                <T variant="caption" color="textTertiary">
                  {f.sourceLicense}
                </T>
              ) : null}
              <Button title="Correct these values" kind="ghost" size="sm" onPress={() => router.push({ pathname: "/food/custom", params: { correctId: f.id } })} />
            </Stack>
          </Card>
        </>
      )}
    </Screen>
  );
}
