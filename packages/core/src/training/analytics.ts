import { startOfIsoWeek, type DayKey } from "../time";
import { bestE1rm, estimateOneRepMax, effectiveRir, isWorkSet, setVolumeKg, type LoggedSet } from "./sets";

export interface ExerciseSessionLog {
  exerciseId: string;
  day: DayKey;
  sets: readonly LoggedSet[];
}

export interface MuscleMap {
  primary: readonly string[];
  secondary: readonly string[];
}

/**
 * Weekly hard sets per muscle: primary muscles count 1 set, secondary 0.5.
 * This is a rough, widely used heuristic for distributing training volume, not
 * a precise measure of stimulus.
 */
export function weeklySetsPerMuscle(
  logs: readonly ExerciseSessionLog[],
  muscles: (exerciseId: string) => MuscleMap | undefined,
): Map<DayKey, Map<string, number>> {
  const weeks = new Map<DayKey, Map<string, number>>();
  for (const log of logs) {
    const m = muscles(log.exerciseId);
    if (!m) continue;
    const n = log.sets.filter(isWorkSet).length;
    if (!n) continue;
    const wk = startOfIsoWeek(log.day);
    const map = weeks.get(wk) ?? new Map<string, number>();
    for (const p of m.primary) map.set(p, (map.get(p) ?? 0) + n);
    for (const s of m.secondary) map.set(s, (map.get(s) ?? 0) + n * 0.5);
    weeks.set(wk, map);
  }
  return weeks;
}

export type PrKind = "e1rm" | "heaviest_weight" | "most_reps_at_weight" | "best_set_volume";

export interface PersonalRecord {
  exerciseId: string;
  kind: PrKind;
  value: number;
  weightKg: number;
  reps: number;
  day: DayKey;
  previous: number | null;
}

/**
 * Detect PRs achieved in `session` relative to all `prior` sessions of the
 * same exercise. Warm-ups and incomplete sets never count.
 */
export function detectPersonalRecords(prior: readonly ExerciseSessionLog[], session: ExerciseSessionLog): PersonalRecord[] {
  const priorSets = prior.filter((p) => p.exerciseId === session.exerciseId && p.day <= session.day).flatMap((p) => p.sets.filter(isWorkSet));
  const sets = session.sets.filter(isWorkSet).filter((s) => s.weightKg > 0);
  if (!sets.length || !priorSets.length) return []; // first session establishes a baseline, not a PR
  const out: PersonalRecord[] = [];
  const base = { exerciseId: session.exerciseId, day: session.day };

  const priorE1 = bestE1rm(priorSets);
  let bestSet: LoggedSet | null = null;
  let bestE: number | null = null;
  for (const s of sets) {
    const e = estimateOneRepMax(s.weightKg, s.reps - (s.assistedReps ?? 0), effectiveRir(s));
    if (e !== null && (bestE === null || e > bestE)) {
      bestE = e;
      bestSet = s;
    }
  }
  if (bestE !== null && bestSet && priorE1 !== null && bestE > priorE1 + 1e-9) {
    out.push({ ...base, kind: "e1rm", value: bestE, weightKg: bestSet.weightKg, reps: bestSet.reps, previous: priorE1 });
  }

  const priorMax = Math.max(...priorSets.map((s) => s.weightKg));
  const heaviest = sets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a));
  if (heaviest.weightKg > priorMax + 1e-9) {
    out.push({ ...base, kind: "heaviest_weight", value: heaviest.weightKg, weightKg: heaviest.weightKg, reps: heaviest.reps, previous: priorMax });
  }

  for (const s of sets) {
    const atWeight = priorSets.filter((p) => Math.abs(p.weightKg - s.weightKg) < 1e-9);
    if (!atWeight.length) continue;
    const prevBest = Math.max(...atWeight.map((p) => p.reps));
    if (s.reps > prevBest && !out.some((r) => r.kind === "most_reps_at_weight" && r.weightKg === s.weightKg)) {
      out.push({ ...base, kind: "most_reps_at_weight", value: s.reps, weightKg: s.weightKg, reps: s.reps, previous: prevBest });
    }
  }

  const priorVol = Math.max(...priorSets.map(setVolumeKg));
  const volSet = sets.reduce((a, b) => (setVolumeKg(b) > setVolumeKg(a) ? b : a));
  if (setVolumeKg(volSet) > priorVol + 1e-9) {
    out.push({ ...base, kind: "best_set_volume", value: setVolumeKg(volSet), weightKg: volSet.weightKg, reps: volSet.reps, previous: priorVol });
  }
  return out;
}

export interface WorkoutSummary {
  durationSec: number;
  exercises: number;
  workSets: number;
  totalReps: number;
  /** Σ load × reps for working sets. Reported, but not treated as a quality score. */
  volumeKg: number;
}

export function summarizeWorkout(startedAt: Date, endedAt: Date, exerciseSets: readonly (readonly LoggedSet[])[], pausedSec = 0): WorkoutSummary {
  let workSets = 0, totalReps = 0, volumeKg = 0, exercises = 0;
  for (const sets of exerciseSets) {
    const ws = sets.filter(isWorkSet);
    if (ws.length) exercises += 1;
    workSets += ws.length;
    for (const s of ws) {
      totalReps += s.reps;
      volumeKg += setVolumeKg(s);
    }
  }
  return {
    durationSec: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) - pausedSec),
    exercises,
    workSets,
    totalReps,
    volumeKg,
  };
}

/** Sessions per ISO week, for consistency views. */
export function sessionsPerWeek(days: readonly DayKey[]): Map<DayKey, number> {
  const m = new Map<DayKey, number>();
  for (const d of new Set(days)) {
    const w = startOfIsoWeek(d);
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}
