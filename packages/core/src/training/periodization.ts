import { addDays, type DayKey } from "../time";
import { nextLoadDown, type LoadProfile } from "./equipment";
import type { ProgressionRecommendation, ReadinessSignal, SessionPerformance } from "./progression";
import { bestE1rm } from "./sets";

/**
 * Training blocks and deloads. A program can run in blocks (e.g. 4 build
 * weeks + 1 deload week); a deload can also be scheduled on demand when
 * fatigue builds. During a deload, volume drops to ~60% and effort eases;
 * load changes are still only suggestions the user confirms.
 */

export const MIN_BLOCK_WEEKS = 3;

export interface BlockPosition {
  week: number;
  of: number;
  deload: boolean;
}

/** Week of the block that `today` falls in, counting whole weeks from `startDay`. Null if blocks are off. */
export function blockPosition(startDay: DayKey | null, blockWeeks: number | null, today: DayKey): BlockPosition | null {
  if (!startDay || !blockWeeks || blockWeeks < MIN_BLOCK_WEEKS || today < startDay) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000);
  const week = (Math.floor(days / 7) % blockWeeks) + 1;
  return { week, of: blockWeeks, deload: week === blockWeeks };
}

/** Whether `today` is in a deload week, from the block cycle or a one-off scheduled deload week. */
export function isDeloadWeek(today: DayKey, block: BlockPosition | null, scheduledDeloadStart: DayKey | null): boolean {
  if (block?.deload) return true;
  return !!scheduledDeloadStart && today >= scheduledDeloadStart && today <= addDays(scheduledDeloadStart, 6);
}

/** Deload version of a recommendation: ~60% of the sets, 2 more reps in reserve, load one step lighter. */
export function deloadRecommendation(rec: ProgressionRecommendation, plannedSets: number, targetRir: number | null | undefined, profile: LoadProfile): ProgressionRecommendation & { targetRir: number } {
  const sets = Math.max(1, Math.round(plannedSets * 0.6));
  const lighter = rec.targetLoadKg != null && rec.targetLoadKg > 0 ? (nextLoadDown(profile, rec.targetLoadKg * 0.92) ?? rec.targetLoadKg) : rec.targetLoadKg;
  return {
    ...rec,
    action: "deload",
    targetSets: sets,
    targetLoadKg: lighter,
    targetReps: rec.targetReps.slice(0, sets),
    targetRir: Math.min(5, (targetRir ?? 2) + 2),
    reasons: [...rec.reasons, `Deload week: ${sets} of ${plannedSets} sets, a little lighter, stopping well short of failure. Recovery now lets you push harder next week.`],
    requiresConfirmation: true,
  };
}

export interface LiftHistory {
  exerciseName: string;
  sessions: readonly SessionPerformance[];
}

export interface FatigueAssessment {
  suggestDeload: boolean;
  regressingLifts: string[];
  reasons: string[];
}

/**
 * Suggest a deload when performance is falling, not just flat: a lift
 * "regresses" when its latest best estimated 1RM is more than 3% below the
 * best of the two sessions before it. Two regressing lifts, or one plus poor
 * recovery signals, suggest a deload. Correlation with fatigue is likely but
 * not certain, so this is a suggestion with its evidence.
 */
export function assessFatigue(lifts: readonly LiftHistory[], readiness: ReadinessSignal = "normal"): FatigueAssessment {
  const regressing: string[] = [];
  for (const l of lifts) {
    const series = [...l.sessions].sort((a, b) => (a.day < b.day ? -1 : 1)).map((s) => bestE1rm(s.sets)).filter((v): v is number => v != null);
    if (series.length < 3) continue;
    const last = series.at(-1)!;
    const before = Math.max(series.at(-2)!, series.at(-3)!);
    if (last < before * 0.97) regressing.push(l.exerciseName);
  }
  const suggest = regressing.length >= 2 || (regressing.length === 1 && readiness === "poor");
  const reasons: string[] = [];
  if (regressing.length) reasons.push(`Estimated strength dropped on ${regressing.join(", ")} compared with your previous two sessions.`);
  if (readiness === "poor") reasons.push("Recent sleep, resting heart rate or check-ins are worse than your usual.");
  if (suggest) reasons.push("A lighter week usually lets performance rebound. This is a suggestion, not a diagnosis.");
  return { suggestDeload: suggest, regressingLifts: regressing, reasons };
}
