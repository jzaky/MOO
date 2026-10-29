import { mergeTotals, sumNutrients, type NutrientKey, type NutrientTotals, type NutrientValues } from "./nutrients";

export const DEFAULT_MEALS = ["breakfast", "lunch", "dinner", "snacks"] as const;

export interface DiaryEntry {
  id: string;
  meal: string;
  nutrients: NutrientValues;
  loggedAt: string;
  /** Whether the values came from an AI estimate the user confirmed, a database record, etc. */
  provenance?: "database" | "label" | "user" | "ai_estimate" | "recipe";
}

export interface MacroTargets {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
}

export interface MacroProgress {
  key: NutrientKey;
  consumed: number;
  target: number;
  remaining: number;
  fraction: number;
  /** Entries lacking this nutrient — consumed is a lower bound when > 0. */
  missingEntries: number;
}

export interface DaySummary {
  meals: { meal: string; totals: NutrientTotals; entryCount: number }[];
  totals: NutrientTotals;
  progress: MacroProgress[];
  entryCount: number;
}

export function summarizeDay(entries: readonly DiaryEntry[], targets: MacroTargets, mealOrder: readonly string[] = DEFAULT_MEALS): DaySummary {
  const byMeal = new Map<string, DiaryEntry[]>();
  for (const m of mealOrder) byMeal.set(m, []);
  for (const e of entries) {
    const arr = byMeal.get(e.meal) ?? [];
    arr.push(e);
    byMeal.set(e.meal, arr);
  }
  const meals = [...byMeal.entries()].map(([meal, es]) => ({ meal, totals: sumNutrients(es.map((e) => e.nutrients)), entryCount: es.length }));
  const totals = mergeTotals(meals.map((m) => m.totals));
  const keys: [NutrientKey, number | undefined][] = [
    ["energyKcal", targets.energyKcal],
    ["proteinG", targets.proteinG],
    ["carbsG", targets.carbsG],
    ["fatG", targets.fatG],
    ["fiberG", targets.fiberG],
  ];
  const progress: MacroProgress[] = [];
  for (const [key, target] of keys) {
    if (target === undefined) continue;
    const consumed = totals[key].value;
    progress.push({
      key,
      consumed,
      target,
      remaining: target - consumed,
      fraction: target > 0 ? consumed / target : 0,
      missingEntries: totals[key].missing,
    });
  }
  return { meals, totals, progress, entryCount: entries.length };
}

/**
 * Deterministic "remaining" insight sentence, so the UI and the coach phrase
 * numbers the same way and no LLM does the arithmetic.
 */
export function remainingInsight(p: MacroProgress, unit: string, label: string): string {
  const r = Math.round(p.remaining);
  const lowerBound = p.missingEntries > 0 ? " (some entries lack this value)" : "";
  if (r > 0) return `About ${r} ${unit} of ${label} remaining today${lowerBound}.`;
  if (r === 0) return `${label} target reached.`;
  return `${Math.abs(r)} ${unit} over the ${label} target${lowerBound}.`;
}
