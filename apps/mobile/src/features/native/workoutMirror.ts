import type { ActiveExercise, ActiveSet, ActiveWorkout } from "../workout/store";
import type { RestActivityInput, WatchWorkoutState } from "./types";

/**
 * Pure projections of the live workout onto the small payloads the watch and
 * the Live Activity need. Type-only imports from the store keep this module
 * free of runtime dependencies (and of import cycles).
 */

function nextSet(w: ActiveWorkout): { exercise: ActiveExercise; set: ActiveSet } | null {
  for (const exercise of w.exercises) for (const set of exercise.sets) if (!set.completed) return { exercise, set };
  return null;
}

export function setLabel(exercise: ActiveExercise, set: ActiveSet): string {
  const i = exercise.sets.findIndex((s) => s.id === set.id);
  const base = `Set ${i + 1} of ${exercise.sets.length}`;
  return set.kind === "warmup" ? `${base} · warm-up` : set.kind === "drop" ? `${base} · drop` : base;
}

export function watchStateFromWorkout(w: ActiveWorkout | null, now = Date.now()): WatchWorkoutState | null {
  if (!w) return null;
  const n = nextSet(w);
  // While no set is left, keep showing the exercise that was rested on (or the last one).
  const shown = n?.exercise ?? w.exercises.find((e) => e.id === w.rest?.exerciseId) ?? w.exercises.at(-1) ?? null;
  const all = w.exercises.flatMap((e) => e.sets);
  return {
    v: 1,
    workoutId: w.id,
    workoutName: w.name,
    exerciseRowId: shown?.id ?? null,
    exerciseName: shown?.exercise.name ?? null,
    setId: n?.set.id ?? null,
    setLabel: n ? setLabel(n.exercise, n.set) : null,
    weightKg: n ? n.set.weightKg : null,
    reps: n ? n.set.reps : null,
    restEndsAt: w.rest && w.rest.endsAt > now ? w.rest.endsAt : null,
    completedSets: all.filter((s) => s.completed).length,
    totalSets: all.length,
  };
}

/** What the rest Live Activity shows: the exercise and set coming up after this rest. */
export function restActivityInputFromWorkout(w: ActiveWorkout): RestActivityInput | null {
  if (!w.rest) return null;
  const n = nextSet(w);
  if (n) return { endsAt: w.rest.endsAt, exerciseName: n.exercise.exercise.name, setLabel: `Next: ${setLabel(n.exercise, n.set)}` };
  const rested = w.exercises.find((e) => e.id === w.rest!.exerciseId);
  return { endsAt: w.rest.endsAt, exerciseName: rested?.exercise.name ?? w.name, setLabel: "All sets done" };
}
