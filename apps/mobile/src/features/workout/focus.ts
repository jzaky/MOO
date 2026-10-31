import { bestE1rm, type LoggedSet } from "@stoke/core";
import type { ActiveExercise, ActiveSet, ActiveWorkout } from "./store";

export interface FocusPosition {
  exercise: ActiveExercise;
  exerciseIndex: number;
  set: ActiveSet;
  /** 1-based number among the exercise's non-warm-up sets (0 for a warm-up). */
  workingNumber: number;
  workingTotal: number;
}

/** The set to do now: the first one not yet completed, in workout order. Null when every set is done. */
export function focusPosition(w: ActiveWorkout): FocusPosition | null {
  for (const [exerciseIndex, exercise] of w.exercises.entries()) {
    const idx = exercise.sets.findIndex((s) => !s.completed);
    if (idx < 0) continue;
    const set = exercise.sets[idx]!;
    const working = exercise.sets.filter((s) => s.kind !== "warmup");
    return { exercise, exerciseIndex, set, workingNumber: set.kind === "warmup" ? 0 : working.indexOf(set) + 1, workingTotal: working.length };
  }
  return null;
}

/** The set after the current one (possibly in the next exercise), for the "next" preview during rest. */
export function upNext(w: ActiveWorkout): { exercise: ActiveExercise; set: ActiveSet } | null {
  let seenCurrent = false;
  for (const exercise of w.exercises) {
    for (const set of exercise.sets) {
      if (set.completed) continue;
      if (seenCurrent) return { exercise, set };
      seenCurrent = true;
    }
  }
  return null;
}

/** Last session's matching working set ("last time: 80 × 7"), by position among working sets. */
export function previousFor(ex: ActiveExercise, workingNumber: number): { weightKg: number; reps: number } | null {
  if (!ex.previous || workingNumber < 1) return null;
  const s = ex.previous.sets.filter((p) => p.kind !== "warmup")[workingNumber - 1];
  return s ? { weightKg: s.weightKg, reps: s.reps } : null;
}

const asLogged = (s: ActiveSet): LoggedSet => ({ kind: s.kind, weightKg: s.weightKg, reps: s.reps, rir: s.rir, rpe: s.rpe, assistedReps: s.assistedReps, completed: true });

/**
 * Whether completing this set beats the best estimated 1RM on record: the server's all-time best,
 * last session, and sets already done today. No record on a first-ever session (there is nothing
 * to beat yet), for warm-ups, or for sets too long to estimate (more than 15 reps to failure).
 */
export function recordFor(ex: ActiveExercise, set: ActiveSet): { e1rmKg: number; previousKg: number } | null {
  if (set.kind === "warmup") return null;
  // Same estimate the server uses for records (reps in reserve or RPE count toward reps to failure).
  const e1rm = bestE1rm([asLogged(set)]);
  if (e1rm == null) return null;
  const today = ex.sets.filter((s) => s.completed && s.id !== set.id).map(asLogged);
  const baseline = [ex.bestE1rmKg ?? null, ex.previous ? bestE1rm(ex.previous.sets) : null, bestE1rm(today)].reduce<number | null>((a, v) => (v != null && (a == null || v > a) ? v : a), null);
  if (baseline == null) return null;
  // A rounding-level gain is not a record.
  return e1rm > baseline + 0.05 ? { e1rmKg: e1rm, previousKg: baseline } : null;
}

/** Weight step for the +/− dial: 2.5 kg (barbell, machine, cable) or 2 kg dumbbells; 5 lb in pounds. */
export function weightStep(ex: ActiveExercise, units: "metric" | "imperial"): number {
  if (units === "imperial") return 5;
  return ex.exercise.loadProfile === "dumbbell" ? 2 : 2.5;
}
