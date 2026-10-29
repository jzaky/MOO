import type { NutrientKey } from "@stoke/core";
import { t } from "../../i18n";
import type { Food } from "../../lib/types";
import { Badge } from "../../ui/primitives";

/** Short badge for a search row: pork/alcohol for users who avoid them, else "estimate" for standard recipes. */
export function dietRowBadge(f: Food, avoids: boolean) {
  const d = f.dietFlags;
  if (avoids && d) {
    if (d.pork === "contains") return <Badge label={t("pork")} tone="danger" />;
    if (d.alcohol === "contains") return <Badge label={t("alcohol")} tone="danger" />;
    if (d.pork === "may_contain" || d.alcohol === "may_contain") return <Badge label={t("check")} tone="warning" />;
  }
  if (f.source === "standard_recipe") return <Badge label={t("estimate")} tone="info" />;
  if (f.completeness < 1) return <Badge label={t("partial")} tone="warning" />;
  return undefined;
}

/** Plain-language lines for the food page; `warn` marks the ones to highlight. */
export function dietLines(f: Food): { text: string; warn: boolean }[] {
  const d = f.dietFlags;
  if (!d) return [];
  const out: { text: string; warn: boolean }[] = [];
  if (d.pork === "contains") out.push({ text: t("Contains pork ({reasons}).", { reasons: d.reasons.pork.join("; ") }), warn: true });
  else if (d.pork === "may_contain") out.push({ text: t("May contain pork ({reasons}). Check the pack.", { reasons: d.reasons.pork.join("; ") }), warn: true });
  if (d.alcohol === "contains") out.push({ text: t("Contains alcohol ({reasons}).", { reasons: d.reasons.alcohol.join("; ") }), warn: true });
  if (!d.pork && !d.alcohol) out.push({ text: d.ingredientsChecked ? t("No pork or alcohol found in the name or ingredient list.") : t("No pork or alcohol in the name. There's no ingredient list to check."), warn: false });
  if (d.halalLabel) out.push({ text: t("The manufacturer labels this product halal."), warn: false });
  return out;
}

export function dietDisclaimer(): string {
  return t("Stoke reads names and ingredient lists. It can't certify halal: slaughter method, processing aids and cross-contact aren't in food data.");
}

/** Display name for a nutrient (the core metadata labels are English). */
export function nutrientLabel(k: NutrientKey): string {
  switch (k) {
    case "energyKcal": return t("Energy");
    case "proteinG": return t("Protein");
    case "carbsG": return t("Carbohydrate");
    case "fatG": return t("Fat");
    case "fiberG": return t("Fibre");
    case "sugarG": return t("Sugars");
    case "addedSugarG": return t("Added sugars");
    case "saturatedFatG": return t("Saturated fat");
    case "transFatG": return t("Trans fat");
    case "monounsaturatedFatG": return t("Monounsaturated fat");
    case "polyunsaturatedFatG": return t("Polyunsaturated fat");
    case "cholesterolMg": return t("Cholesterol");
    case "sodiumMg": return t("Sodium");
    case "potassiumMg": return t("Potassium");
    case "calciumMg": return t("Calcium");
    case "ironMg": return t("Iron");
    case "magnesiumMg": return t("Magnesium");
    case "zincMg": return t("Zinc");
    case "vitaminAUg": return t("Vitamin A");
    case "vitaminCMg": return t("Vitamin C");
    case "vitaminDUg": return t("Vitamin D");
    case "vitaminB12Ug": return t("Vitamin B12");
    case "folateUg": return t("Folate");
    case "alcoholG": return t("Alcohol");
    case "caffeineMg": return t("Caffeine");
    default: return k;
  }
}

/** Display name for a diary meal key. */
export function mealLabel(meal: string): string {
  return meal === "breakfast" ? t("Breakfast") : meal === "lunch" ? t("Lunch") : meal === "dinner" ? t("Dinner") : meal === "snacks" ? t("Snacks") : meal;
}
