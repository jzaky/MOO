/**
 * Nutrient values and arithmetic.
 *
 * Rule: an unknown nutrient is `null` (or absent), never 0. Totals report how
 * many contributing items were missing a value so the UI can show "≥ 12 g
 * fibre (2 foods missing data)" instead of fabricating precision.
 */

export const MACRO_KEYS = ["energyKcal", "proteinG", "carbsG", "fatG"] as const;

export const NUTRIENT_KEYS = [
  "energyKcal",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sugarG",
  "addedSugarG",
  "saturatedFatG",
  "transFatG",
  "monounsaturatedFatG",
  "polyunsaturatedFatG",
  "cholesterolMg",
  "sodiumMg",
  "potassiumMg",
  "calciumMg",
  "ironMg",
  "magnesiumMg",
  "zincMg",
  "vitaminAUg",
  "vitaminCMg",
  "vitaminDUg",
  "vitaminB12Ug",
  "folateUg",
  "alcoholG",
  "caffeineMg",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Values for some quantity of food. `null`/absent = unknown. */
export type NutrientValues = Partial<Record<NutrientKey, number | null>>;

export interface NutrientTotal {
  /** Sum of known contributions. */
  value: number;
  /** Number of contributing items that had no value for this nutrient. */
  missing: number;
  /** Number of contributing items that had a value. */
  known: number;
}

export type NutrientTotals = Record<NutrientKey, NutrientTotal>;

export const NUTRIENT_META: Record<NutrientKey, { label: string; unit: "kcal" | "g" | "mg" | "µg" }> = {
  energyKcal: { label: "Energy", unit: "kcal" },
  proteinG: { label: "Protein", unit: "g" },
  carbsG: { label: "Carbohydrate", unit: "g" },
  fatG: { label: "Fat", unit: "g" },
  fiberG: { label: "Fibre", unit: "g" },
  sugarG: { label: "Sugars", unit: "g" },
  addedSugarG: { label: "Added sugars", unit: "g" },
  saturatedFatG: { label: "Saturated fat", unit: "g" },
  transFatG: { label: "Trans fat", unit: "g" },
  monounsaturatedFatG: { label: "Monounsaturated fat", unit: "g" },
  polyunsaturatedFatG: { label: "Polyunsaturated fat", unit: "g" },
  cholesterolMg: { label: "Cholesterol", unit: "mg" },
  sodiumMg: { label: "Sodium", unit: "mg" },
  potassiumMg: { label: "Potassium", unit: "mg" },
  calciumMg: { label: "Calcium", unit: "mg" },
  ironMg: { label: "Iron", unit: "mg" },
  magnesiumMg: { label: "Magnesium", unit: "mg" },
  zincMg: { label: "Zinc", unit: "mg" },
  vitaminAUg: { label: "Vitamin A", unit: "µg" },
  vitaminCMg: { label: "Vitamin C", unit: "mg" },
  vitaminDUg: { label: "Vitamin D", unit: "µg" },
  vitaminB12Ug: { label: "Vitamin B12", unit: "µg" },
  folateUg: { label: "Folate", unit: "µg" },
  alcoholG: { label: "Alcohol", unit: "g" },
  caffeineMg: { label: "Caffeine", unit: "mg" },
};

export function isKnown(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Scale per-100 g (or per-100 ml) values to an amount in grams (or ml). */
export function scalePer100(per100: NutrientValues, amount: number): NutrientValues {
  if (!(amount >= 0)) throw new RangeError(`amount must be a non-negative number, got ${amount}`);
  const out: NutrientValues = {};
  for (const key of NUTRIENT_KEYS) {
    const v = per100[key];
    if (isKnown(v)) out[key] = (v * amount) / 100;
    else if (v === null) out[key] = null;
  }
  return out;
}

/** Multiply every known value by a factor (e.g. number of servings). */
export function multiplyNutrients(values: NutrientValues, factor: number): NutrientValues {
  if (!(factor >= 0)) throw new RangeError(`factor must be a non-negative number, got ${factor}`);
  const out: NutrientValues = {};
  for (const key of NUTRIENT_KEYS) {
    const v = values[key];
    if (isKnown(v)) out[key] = v * factor;
    else if (v === null) out[key] = null;
  }
  return out;
}

export function emptyTotals(): NutrientTotals {
  const t = {} as NutrientTotals;
  for (const key of NUTRIENT_KEYS) t[key] = { value: 0, missing: 0, known: 0 };
  return t;
}

/** Sum nutrient values across items, tracking missing data per nutrient. */
export function sumNutrients(items: readonly NutrientValues[]): NutrientTotals {
  const totals = emptyTotals();
  for (const item of items) {
    for (const key of NUTRIENT_KEYS) {
      const v = item[key];
      const t = totals[key];
      if (isKnown(v)) {
        t.value += v;
        t.known += 1;
      } else {
        t.missing += 1;
      }
    }
  }
  return totals;
}

/** Combine totals (e.g. meal totals into a day total). */
export function mergeTotals(parts: readonly NutrientTotals[]): NutrientTotals {
  const totals = emptyTotals();
  for (const p of parts) {
    for (const key of NUTRIENT_KEYS) {
      totals[key].value += p[key].value;
      totals[key].missing += p[key].missing;
      totals[key].known += p[key].known;
    }
  }
  return totals;
}

/** Collapse totals back to values; nutrients with no known contributions become null. */
export function totalsToValues(totals: NutrientTotals): NutrientValues {
  const out: NutrientValues = {};
  for (const key of NUTRIENT_KEYS) {
    const t = totals[key];
    out[key] = t.known > 0 ? t.value : null;
  }
  return out;
}

export const ATWATER = { proteinG: 4, carbsG: 4, fatG: 9, alcoholG: 7 } as const;

/** Energy implied by macros using general Atwater factors. Null when a macro is unknown. */
export function energyFromMacros(v: NutrientValues): number | null {
  const { proteinG, carbsG, fatG } = v;
  if (!isKnown(proteinG) || !isKnown(carbsG) || !isKnown(fatG)) return null;
  const alcohol = isKnown(v.alcoholG) ? v.alcoholG : 0;
  return proteinG * ATWATER.proteinG + carbsG * ATWATER.carbsG + fatG * ATWATER.fatG + alcohol * ATWATER.alcoholG;
}

export interface ConsistencyCheck {
  ok: boolean;
  statedKcal: number | null;
  impliedKcal: number | null;
  /** Relative difference |stated - implied| / max(stated, implied). */
  relativeDiff: number | null;
}

/**
 * Data-quality check: does stated energy roughly match macros? Labels round
 * values and fibre/polyols have different factors, so the tolerance is loose.
 * A failure flags the record for review; it never rewrites the data.
 */
export function checkEnergyConsistency(v: NutrientValues, tolerance = 0.2, absoluteSlackKcal = 15): ConsistencyCheck {
  const stated = isKnown(v.energyKcal) ? v.energyKcal : null;
  const implied = energyFromMacros(v);
  if (stated === null || implied === null) return { ok: true, statedKcal: stated, impliedKcal: implied, relativeDiff: null };
  const diff = Math.abs(stated - implied);
  const denom = Math.max(stated, implied, 1);
  const rel = diff / denom;
  return { ok: diff <= absoluteSlackKcal || rel <= tolerance, statedKcal: stated, impliedKcal: implied, relativeDiff: rel };
}

/** Fraction of the given keys that have known values (0..1). */
export function completeness(v: NutrientValues, keys: readonly NutrientKey[] = MACRO_KEYS): number {
  if (keys.length === 0) return 1;
  let known = 0;
  for (const k of keys) if (isKnown(v[k])) known += 1;
  return known / keys.length;
}
