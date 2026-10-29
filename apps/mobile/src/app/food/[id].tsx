import type { PortionDto } from "@stoke/contracts";
import { isKnown, NUTRIENT_META, nutrientsForPortion, PortionError, type NutrientKey, type PortionInput } from "@stoke/core";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { defaultMealForNow, logFood, qk, useFavorites, useFood, useProfile } from "../../lib/data";
import { dietDisclaimer, dietLines, mealLabel, nutrientLabel } from "../../features/food/diet";
import { t, tn } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Chip, Divider, ErrorState, Field, IconButton, Row, SectionHeader, Skeleton, Stack, Stepper, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

function flagText(flag: string): string | null {
  switch (flag) {
    case "energy_macro_mismatch": return t("Energy doesn't match the macros; one of the values may be wrong.");
    case "missing_macros": return t("Some macronutrients are missing for this food.");
    case "energy_from_kj": return t("Calories were converted from kilojoules.");
    case "sodium_from_salt": return t("Sodium was calculated from salt.");
    case "serving_unit_mismatch": return t("The listed serving size didn't match the nutrition basis and was ignored.");
    case "per100_from_raw_weight": return t("Per-gram values use raw ingredient weight (no cooked weight given).");
    case "unmatched_ingredients": return t("Some recipe ingredients have no nutrition data.");
    case "user_corrected": return t("You corrected this food.");
    case "estimate": return t("An estimate from a typical recipe. Home and restaurant versions vary, so weigh or adjust when you can.");
    default: return null;
  }
}

const DETAIL_KEYS: NutrientKey[] = ["fiberG", "sugarG", "saturatedFatG", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "cholesterolMg"];

export default function FoodDetail() {
  const th = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string; day?: string; meal?: string; entryId?: string; grams?: string }>();
  const food = useFood(params.id);
  const favs = useFavorites();
  const f = food.data;
  const profile = useProfile();
  const avoidsPorkAlcohol = profile.data?.dietary.pattern === "halal";
  const diet = f ? dietLines(f) : [];
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
      title={f?.name ?? t("Food")}
      subtitle={f?.brand ?? undefined}
      right={f ? <IconButton icon="star" label={isFav ? t("Remove from favourites") : t("Add to favourites")} color={isFav ? "warning" : "textTertiary"} onPress={() => void toggleFav()} /> : undefined}
      footer={f ? <Button title={params.entryId ? t("Update entry") : t("Add to {meal}", { meal: mealLabel(meal) })} onPress={submit} disabled={!portion || !preview} /> : undefined}
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
                    ["proteinG", t("Protein"), th.c.protein],
                    ["carbsG", t("Carbs"), th.c.carbs],
                    ["fatG", t("Fat"), th.c.fat],
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

          <SectionHeader title={t("Amount")} />
          <Row gap={8} wrap>
            {f.servings.map((s) => (
              <Chip key={s.id} label={`${s.label}${s.label.includes(String(Math.round(s.baseAmount))) ? "" : ` (${Math.round(s.baseAmount)} ${f.baseUnit})`}`} selected={activeServing === s.id} onPress={() => setServingId(s.id)} />
            ))}
            <Chip label={f.baseUnit === "g" ? t("Grams") : t("Millilitres")} selected={activeServing === "base"} onPress={() => setServingId("base")} />
          </Row>
          {activeServing === "base" ? (
            <Field value={amount} onChangeText={setAmount} keyboardType="decimal-pad" suffix={f.baseUnit} selectTextOnFocus accessibilityLabel={t("Amount in {unit}", { unit: f.baseUnit })} />
          ) : (
            <Stepper value={qty} onChange={setQty} step={0.5} min={0.25} max={50} label={t("Servings")} format={(x) => (Number.isInteger(x) ? tn(x, "{n} serving", "{n} servings") : t("{n} servings", { n: x }))} />
          )}

          <SectionHeader title={t("Meal")} />
          <Row gap={8} wrap>
            {["breakfast", "lunch", "dinner", "snacks"].map((m) => (
              <Chip key={m} label={mealLabel(m)} selected={meal === m} onPress={() => setMeal(m)} />
            ))}
          </Row>

          <SectionHeader title={t("Nutrition")} action={showAll ? t("Less") : t("More")} onAction={() => setShowAll((x) => !x)} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {(showAll ? (Object.keys(NUTRIENT_META) as NutrientKey[]).filter((k) => !["energyKcal", "proteinG", "carbsG", "fatG"].includes(k)) : DETAIL_KEYS).map((k, i) => (
              <View key={k}>
                {i ? <Divider /> : null}
                <Row justify="space-between" style={{ paddingVertical: 11 }}>
                  <T variant="subhead" color="textSecondary">
                    {nutrientLabel(k)}
                  </T>
                  <T variant="subhead">{fmt(k)}</T>
                </Row>
              </View>
            ))}
          </Card>
          <T variant="caption" color="textTertiary">
            {t("“—” means the source has no value for that nutrient. It is never counted as zero.")}
          </T>

          {f.standardRecipe ? (
            <>
              <SectionHeader title={t("How this estimate is made")} />
              <Card>
                <Stack gap={8}>
                  <T variant="footnote" color="textSecondary">{t("A typical {serving} ({grams} g) built from USDA ingredients. Nutrition is calculated from these amounts.", { serving: f.servings[0]?.label ?? t("serving"), grams: f.standardRecipe.servingG })}</T>
                  {f.standardRecipe.ingredients.map((i) => (
                    <Row key={`${i.label}-${i.grams}`} justify="space-between">
                      <T variant="subhead" style={{ flex: 1 }}>{i.label}</T>
                      <T variant="subhead" color="textSecondary">{i.grams} g</T>
                    </Row>
                  ))}
                  {f.standardRecipe.substitutions.map((x) => <T key={x} variant="caption" color="textTertiary">{t("Closest USDA match: {item}.", { item: x })}</T>)}
                </Stack>
              </Card>
            </>
          ) : null}

          {diet.length && (avoidsPorkAlcohol || f.dietFlags?.pork || f.dietFlags?.alcohol || f.dietFlags?.halalLabel) ? (
            <>
              <SectionHeader title={t("Pork and alcohol")} />
              <Card>
                <Stack gap={6}>
                  {diet.map((l) => <T key={l.text} variant="footnote" color={l.warn ? "warning" : "textSecondary"}>{l.text}</T>)}
                  <T variant="caption" color="textTertiary">{dietDisclaimer()}</T>
                </Stack>
              </Card>
            </>
          ) : null}

          <SectionHeader title={t("Source")} />
          <Card>
            <Stack gap={8}>
              <Row gap={8} wrap>
                <Badge label={f.isPrivate ? t("Your food") : f.source === "off" ? "Open Food Facts" : f.source === "usda" ? "USDA" : f.source === "standard_recipe" ? t("Standard recipe") : f.source} tone={f.isPrivate ? "accent" : "neutral"} />
                {f.completeness < 1 ? <Badge label={t("Incomplete")} tone="warning" /> : null}
                {f.barcode ? <Badge label={f.barcode} /> : null}
              </Row>
              {f.quality.flags.map((fl) => { const txt = flagText(fl); return txt ? <T key={fl} variant="footnote" color="textSecondary">{txt}</T> : null; })}
              {f.sourceLicense && !f.isPrivate ? (
                <T variant="caption" color="textTertiary">
                  {f.sourceLicense}
                </T>
              ) : null}
              <Button title={t("Correct these values")} kind="ghost" size="sm" onPress={() => router.push({ pathname: "/food/custom", params: { correctId: f.id } })} />
            </Stack>
          </Card>
        </>
      )}
    </Screen>
  );
}
