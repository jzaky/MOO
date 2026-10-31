/** Planned weekly sets per muscle from a program, counted like the server's analytics:
 *  a primary muscle gets the full set, a secondary muscle half. */
export function plannedSetsPerMuscle(days: { exercises: { exercise: { primaryMuscles: string[]; secondaryMuscles?: string[] }; prescription: { sets: number } }[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days)
    for (const e of d.exercises) {
      for (const m of e.exercise.primaryMuscles) out[m] = (out[m] ?? 0) + e.prescription.sets;
      for (const m of e.exercise.secondaryMuscles ?? []) out[m] = (out[m] ?? 0) + e.prescription.sets / 2;
    }
  return out;
}

export interface MuscleRow {
  muscle: string;
  done: number;
  planned: number;
  /** done / planned, or null when nothing is planned for it. */
  ratio: number | null;
}

/** One row per muscle that is planned or trained, sorted by plan size, then by sets done. */
export function muscleRows(done: Record<string, number>, planned: Record<string, number>): MuscleRow[] {
  const keys = new Set([...Object.keys(planned), ...Object.keys(done)]);
  return [...keys]
    .map((m) => ({ muscle: m, done: Math.round((done[m] ?? 0) * 2) / 2, planned: Math.round((planned[m] ?? 0) * 2) / 2, ratio: planned[m] ? (done[m] ?? 0) / planned[m] : null }))
    .filter((r) => r.planned > 0 || r.done > 0)
    .sort((a, b) => b.planned - a.planned || b.done - a.done || a.muscle.localeCompare(b.muscle));
}

/** Brightness step for the body map: 0 none yet, 1–4 rising, 4 = on or over plan; null = not in the plan. */
export function heatLevel(ratio: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (ratio == null) return null;
  if (ratio <= 0) return 0;
  if (ratio < 0.34) return 1;
  if (ratio < 0.67) return 2;
  if (ratio < 1) return 3;
  return 4;
}
