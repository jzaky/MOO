/** Set-level types and strength estimates. */

export type SetKind = "warmup" | "working" | "drop" | "failure" | "backoff";

export interface LoggedSet {
  /** Load in kg (external load; 0 for pure bodyweight). Negative = assistance. */
  weightKg: number;
  reps: number;
  kind: SetKind;
  rir?: number | null;
  rpe?: number | null;
  completed: boolean;
  /** Reps completed with spotter/assistance (not counted toward e1RM). */
  assistedReps?: number | null;
}

export function isWorkSet(s: LoggedSet): boolean {
  return s.completed && s.kind !== "warmup" && s.reps > 0;
}

/** RIR from RPE where only RPE was logged (RPE 10 = 0 RIR). */
export function effectiveRir(s: Pick<LoggedSet, "rir" | "rpe">): number | null {
  if (s.rir != null) return s.rir;
  if (s.rpe != null) return Math.max(0, 10 - s.rpe);
  return null;
}

/**
 * Estimated one-rep max (Epley), adjusted for reps in reserve when known:
 * a set of 8 @ 2 RIR is treated like a 10-rep max. Unreliable above ~12 reps;
 * returns null beyond 15 so we don't present noisy numbers as strength.
 */
export function estimateOneRepMax(weightKg: number, reps: number, rir?: number | null): number | null {
  if (!(weightKg > 0) || !(reps >= 1)) return null;
  const repsToFailure = reps + Math.max(0, rir ?? 0);
  if (repsToFailure > 15) return null;
  if (repsToFailure === 1) return weightKg;
  return weightKg * (1 + repsToFailure / 30);
}

export function setVolumeKg(s: LoggedSet): number {
  return Math.max(0, s.weightKg) * Math.max(0, s.reps - (s.assistedReps ?? 0));
}

/** Best estimated 1RM across a list of sets. */
export function bestE1rm(sets: readonly LoggedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!isWorkSet(s)) continue;
    const e = estimateOneRepMax(s.weightKg, s.reps - (s.assistedReps ?? 0), effectiveRir(s));
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
}
