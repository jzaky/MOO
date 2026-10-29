/**
 * Deterministic split suggestion from availability and experience. This only
 * chooses a structure; exercise selection happens in the program generator.
 */

export type Experience = "new" | "beginner" | "intermediate" | "advanced";
export type SplitKind = "full_body" | "upper_lower" | "push_pull_legs" | "hybrid";

export interface SplitSuggestion {
  split: SplitKind;
  daysPerWeek: number;
  dayNames: string[];
  /** ISO weekdays (1=Mon) assigned to each training day. */
  weekdays: number[];
  rationale: string;
}

const DEFAULT_DAYS: Record<number, number[]> = {
  1: [3],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

export function suggestSplit(preferredDays: readonly number[], experience: Experience, enduranceFocus = false): SplitSuggestion {
  const uniq = [...new Set(preferredDays.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
  let n = uniq.length || 3;
  // Novices recover and progress well on 2–4 days; cap to keep the plan sustainable.
  if ((experience === "new" || experience === "beginner") && n > 4) n = 4;
  if (n > 6) n = 6;
  const weekdays = uniq.length >= n ? spread(uniq, n) : DEFAULT_DAYS[n]!;

  if (enduranceFocus) {
    return { split: "hybrid", daysPerWeek: n, weekdays, dayNames: weekdays.map((_, i) => (i % 2 === 0 ? "Strength (full body)" : "Conditioning")), rationale: "Alternating full-body strength and conditioning supports an endurance goal while keeping strength work." };
  }
  if (n <= 3) {
    return { split: "full_body", daysPerWeek: n, weekdays, dayNames: weekdays.map((_, i) => `Full Body ${String.fromCharCode(65 + i)}`), rationale: `With ${n} training day${n > 1 ? "s" : ""}, full-body sessions train each muscle ${n > 1 ? "multiple times" : "at least once"} per week.` };
  }
  if (n === 4 || experience === "new" || experience === "beginner") {
    return { split: "upper_lower", daysPerWeek: n, weekdays, dayNames: ["Upper A", "Lower A", "Upper B", "Lower B"].slice(0, n), rationale: "Four days suits an upper/lower split: each muscle is trained twice a week with manageable session length." };
  }
  const names = n === 5 ? ["Push", "Pull", "Legs", "Upper", "Lower"] : ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"];
  return { split: "push_pull_legs", daysPerWeek: n, weekdays, dayNames: names, rationale: `${n} days allows a push/pull/legs rotation${n === 5 ? " with an upper/lower pair" : " run twice"}.` };
}

/** Choose n of the available days, spread across the week. */
function spread(days: number[], n: number): number[] {
  if (days.length === n) return days;
  const out: number[] = [];
  const step = days.length / n;
  for (let i = 0; i < n; i++) out.push(days[Math.floor(i * step)]!);
  return out;
}

export interface MeasurementSchedule {
  weighIns: string;
  circumferences: string;
  photos: string;
  checkIn: string;
}

export const DEFAULT_MEASUREMENT_SCHEDULE: MeasurementSchedule = {
  weighIns: "Daily or at least 3 mornings per week, after the bathroom and before eating. The trend matters, not any single reading.",
  circumferences: "Waist (and optionally chest, hips, arms, thighs) every 2 weeks, same time of day.",
  photos: "Front, side and back every 4 weeks in similar lighting.",
  checkIn: "A weekly review compares trend weight, intake, training and recovery before any target changes.",
};
