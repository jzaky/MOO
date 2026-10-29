import { isKnown, scalePer100, sumNutrients, totalsToValues, type NutrientValues } from "./nutrients";

/**
 * Deterministic final stage of the photo-recognition pipeline.
 *
 * The vision model proposes components (identity + portion range + confidence);
 * the food database supplies per-100 g nutrition; THIS module does the
 * arithmetic and decides how each component must be presented:
 *
 *   high   (≥ 0.80) → pre-selected, simple confirmation
 *   medium (≥ 0.50) → show alternatives
 *   low    (<  0.50) → ask the user to identify the food
 *
 * Energy is reported as a range derived from the portion range so the UI never
 * shows a falsely precise single number for an estimate.
 */

export type ConfidenceTier = "high" | "medium" | "low";

export const CONFIDENCE_THRESHOLDS = { high: 0.8, medium: 0.5 } as const;

export function confidenceTier(c: number): ConfidenceTier {
  if (c >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (c >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

export interface RecognizedComponent {
  id: string;
  label: string;
  identityConfidence: number;
  /** Best estimate and plausible range of the edible portion in grams. */
  grams: { estimate: number; low: number; high: number };
  portionConfidence: number;
  /** Nutrition per 100 g from the matched database food; null when unmatched. */
  matchedPer100: NutrientValues | null;
  alternatives?: string[];
}

export interface ComponentEstimate {
  id: string;
  label: string;
  tier: ConfidenceTier;
  needsUserInput: boolean;
  nutrients: NutrientValues | null;
  energyRangeKcal: { low: number; high: number } | null;
}

export interface MealEstimate {
  components: ComponentEstimate[];
  totals: NutrientValues;
  energyRangeKcal: { low: number; high: number } | null;
  /** Components excluded from totals because they are unmatched or low confidence. */
  excludedComponentIds: string[];
  status: "ready_to_confirm" | "needs_clarification";
}

export function estimateMeal(components: readonly RecognizedComponent[]): MealEstimate {
  const out: ComponentEstimate[] = [];
  const included: NutrientValues[] = [];
  const excluded: string[] = [];
  let lowSum = 0, highSum = 0, rangeKnown = false;

  for (const c of components) {
    const g = c.grams;
    if (!(g.low >= 0 && g.estimate >= g.low && g.high >= g.estimate)) throw new RangeError(`Invalid portion range for ${c.label}`);
    const tier = confidenceTier(Math.min(c.identityConfidence, Math.max(c.portionConfidence, 0.5)));
    const identityTier = confidenceTier(c.identityConfidence);
    const needsUserInput = identityTier === "low" || c.matchedPer100 === null;
    let nutrients: NutrientValues | null = null;
    let energyRange: { low: number; high: number } | null = null;
    if (c.matchedPer100) {
      nutrients = scalePer100(c.matchedPer100, g.estimate);
      const e = c.matchedPer100.energyKcal;
      if (isKnown(e)) energyRange = { low: (e * g.low) / 100, high: (e * g.high) / 100 };
    }
    if (needsUserInput || !nutrients) {
      excluded.push(c.id);
    } else {
      included.push(nutrients);
      if (energyRange) {
        lowSum += energyRange.low;
        highSum += energyRange.high;
        rangeKnown = true;
      }
    }
    out.push({ id: c.id, label: c.label, tier, needsUserInput, nutrients, energyRangeKcal: energyRange });
  }

  return {
    components: out,
    totals: totalsToValues(sumNutrients(included)),
    energyRangeKcal: rangeKnown ? { low: Math.round(lowSum), high: Math.round(highSum) } : null,
    excludedComponentIds: excluded,
    status: excluded.length ? "needs_clarification" : "ready_to_confirm",
  };
}

/**
 * Before/after photos: the model estimates the fraction left over; we clamp it
 * and scale. Still an estimate — the UI labels it as such.
 */
export function consumedFraction(leftoverFraction: number): number {
  if (!Number.isFinite(leftoverFraction)) return 1;
  return 1 - Math.min(1, Math.max(0, leftoverFraction));
}
