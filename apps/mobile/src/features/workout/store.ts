import type { PrescriptionDto } from "@stoke/contracts";
import type { LoggedSet, ProgressionRecommendation } from "@stoke/core";
import { useSyncExternalStore } from "react";
import { haptic } from "../../lib/haptics";
import { nowIso, todayKey, uuid } from "../../lib/ids";
import { enqueue } from "../../lib/outbox";
import { kv } from "../../lib/storage";
import type { Exercise, StartWorkout } from "../../lib/types";
import { endRestActivity, startRestActivity, updateRestActivity } from "../native/liveActivity";
import type { WatchAction } from "../native/types";
import { sendWorkoutState } from "../native/watch";
import { restActivityInputFromWorkout, watchStateFromWorkout } from "../native/workoutMirror";

/**
 * The live workout is local-first: the device is the source of truth while
 * training. Every change is persisted immediately (survives app kills and
 * offline gyms) and a coalesced snapshot is queued to the server via the
 * outbox (idempotent PUT /v1/workouts/:id).
 */

export type SetKind = LoggedSet["kind"];

export interface ActiveSet {
  id: string;
  position: number;
  kind: SetKind;
  weightKg: number;
  reps: number;
  rir: number | null;
  rpe: number | null;
  assistedReps: number | null;
  completed: boolean;
  completedAt: string | null;
  targetWeightKg: number | null;
  targetReps: number | null;
}

export interface ActiveExercise {
  id: string;
  exerciseId: string;
  exercise: Pick<Exercise, "id" | "name" | "loadProfile" | "equipment" | "primaryMuscles">;
  supersetGroup: number | null;
  prescription: PrescriptionDto | null;
  previous: { day: string; sets: LoggedSet[] } | null;
  recommendation: ProgressionRecommendation | null;
  sets: ActiveSet[];
  notes: string | null;
  suggestionApplied?: boolean;
  /** Best estimated 1RM before this workout (from the server), for the live record cue. */
  bestE1rmKg?: number | null;
}

export interface ActiveWorkout {
  id: string;
  templateId: string | null;
  name: string;
  day: string;
  startedAt: string;
  pausedAt: string | null;
  pausedSec: number;
  exercises: ActiveExercise[];
  rest: { endsAt: number; durationSec: number; exerciseId: string } | null;
  notes: string | null;
}

const KEY = "workout.active";
let state: ActiveWorkout | null = kv.get<ActiveWorkout>(KEY);
const listeners = new Set<() => void>();

function commit(next: ActiveWorkout | null, sync = true) {
  const prev = state;
  state = next;
  if (next) kv.set(KEY, next);
  else kv.remove(KEY);
  listeners.forEach((l) => l());
  if (next && sync) queueSnapshot(next, "active");
  mirrorToNative(prev, next);
}

/**
 * Mirrors every committed change to the native surfaces: the Apple Watch gets
 * the current exercise / next set / rest, and the rest-timer Live Activity is
 * started (rest begins in toggleSetComplete), updated (adjustRest) or ended
 * (skipRest, togglePause, finishWorkout, discardWorkout). Best-effort: a
 * native failure never affects the workout itself.
 */
function mirrorToNative(prev: ActiveWorkout | null, next: ActiveWorkout | null) {
  try {
    sendWorkoutState(watchStateFromWorkout(next));
    const was = prev?.rest ?? null;
    const now = next?.rest ?? null;
    if (!next || !now) {
      if (was || !next) endRestActivity();
      return;
    }
    if (was && was.endsAt === now.endsAt && was.exerciseId === now.exerciseId) return;
    const input = restActivityInputFromWorkout(next);
    if (!input) return;
    if (was) updateRestActivity(input);
    else startRestActivity(input);
  } catch {
    // Native mirrors are optional.
  }
}

/** Re-sends the current state to the watch and reconciles the Live Activity (call once at startup). */
export function syncNativeSurfaces(): void {
  try {
    sendWorkoutState(watchStateFromWorkout(state));
    const input = state?.rest && state.rest.endsAt > Date.now() ? restActivityInputFromWorkout(state) : null;
    if (input) startRestActivity(input);
    else endRestActivity();
  } catch {
    // Native mirrors are optional.
  }
}

function update(fn: (w: ActiveWorkout) => ActiveWorkout, sync = true) {
  if (state) commit(fn(state), sync);
}

export function useActiveWorkout(): ActiveWorkout | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function getActiveWorkout(): ActiveWorkout | null {
  return state;
}

function snapshotBody(w: ActiveWorkout, status: "active" | "completed" | "discarded") {
  const endedAt = status === "completed" ? nowIso() : null;
  return {
    templateId: w.templateId,
    name: w.name,
    day: w.day,
    startedAt: w.startedAt,
    endedAt,
    pausedSec: Math.round(w.pausedSec + (w.pausedAt ? (Date.now() - Date.parse(w.pausedAt)) / 1000 : 0)),
    status,
    notes: w.notes,
    clientUpdatedAt: nowIso(),
    exercises: w.exercises.map((e, i) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      position: i,
      supersetGroup: e.supersetGroup,
      prescription: e.prescription,
      notes: e.notes,
      sets: e.sets.map((s, j) => ({ id: s.id, position: j, kind: s.kind, weightKg: s.weightKg, reps: s.reps, rir: s.rir, rpe: s.rpe, assistedReps: s.assistedReps, completed: s.completed, completedAt: s.completedAt, targetWeightKg: s.targetWeightKg, targetReps: s.targetReps, originalUnit: "kg" as const })),
    })),
  };
}

function queueSnapshot(w: ActiveWorkout, status: "active" | "completed" | "discarded") {
  enqueue({ method: "PUT", path: `/v1/workouts/${w.id}`, body: snapshotBody(w, status) });
}

/** Load changes the engine suggests are never applied silently: sets start at the previous load. */
export function changesLoad(rec: ProgressionRecommendation | null, previous: ActiveExercise["previous"]): boolean {
  if (!rec || rec.targetLoadKg == null) return false;
  const prevLoad = previous?.sets.filter((s) => s.kind !== "warmup").at(-1)?.weightKg;
  return prevLoad !== undefined && Math.abs(prevLoad - rec.targetLoadKg) > 1e-9;
}

function setsFromRecommendation(rec: ProgressionRecommendation | null, rx: PrescriptionDto | null, previous: ActiveExercise["previous"]): ActiveSet[] {
  const prevWork = previous?.sets.filter((s) => s.kind !== "warmup") ?? [];
  const loadChange = changesLoad(rec, previous);
  const n = (loadChange ? rx?.sets : rec?.targetSets) ?? rx?.sets ?? 3;
  return Array.from({ length: n }, (_, i) => {
    const prevSet = prevWork[i] ?? prevWork.at(-1);
    const weight = loadChange ? prevSet?.weightKg ?? 0 : rec?.targetLoadKg ?? prevSet?.weightKg ?? 0;
    const reps = loadChange ? prevSet?.reps ?? rx?.repRange.min ?? 8 : rec?.targetReps[i] ?? rx?.repRange.min ?? 8;
    return { id: uuid(), position: i, kind: "working", weightKg: weight, reps, rir: null, rpe: null, assistedReps: null, completed: false, completedAt: null, targetWeightKg: rec?.targetLoadKg ?? null, targetReps: rec?.targetReps[i] ?? null };
  });
}

/** User accepted the suggested target: apply it to every set not yet completed. */
export function applySuggestion(exerciseRowId: string): void {
  update((w) => ({
    ...w,
    exercises: w.exercises.map((e) => {
      if (e.id !== exerciseRowId || !e.recommendation) return e;
      const r = e.recommendation;
      const incomplete = e.sets.filter((s) => !s.completed);
      const done = e.sets.filter((s) => s.completed);
      const want = Math.max(0, r.targetSets - done.length);
      const sets = [...done];
      for (let i = 0; i < want; i++) {
        const base = incomplete[i];
        sets.push({ ...(base ?? { id: uuid(), kind: "working" as const, rir: null, rpe: null, assistedReps: null, completed: false, completedAt: null }), position: sets.length, weightKg: r.targetLoadKg ?? base?.weightKg ?? 0, reps: r.targetReps[done.length + i] ?? r.targetReps.at(-1) ?? base?.reps ?? 8, targetWeightKg: r.targetLoadKg, targetReps: r.targetReps[done.length + i] ?? null } as ActiveSet);
      }
      return { ...e, sets, suggestionApplied: true };
    }),
  }));
  haptic("light");
}

export function startFromTemplate(start: StartWorkout): ActiveWorkout {
  const w: ActiveWorkout = {
    id: uuid(),
    templateId: start.template.id,
    name: start.template.name,
    day: todayKey(),
    startedAt: nowIso(),
    pausedAt: null,
    pausedSec: 0,
    rest: null,
    notes: null,
    exercises: start.items.map((it) => ({
      id: uuid(),
      exerciseId: it.exercise.id,
      exercise: { id: it.exercise.id, name: it.exercise.name, loadProfile: it.exercise.loadProfile, equipment: it.exercise.equipment, primaryMuscles: it.exercise.primaryMuscles },
      supersetGroup: it.supersetGroup,
      prescription: it.prescription,
      previous: it.previous,
      recommendation: it.recommendation,
      sets: setsFromRecommendation(it.recommendation, it.prescription, it.previous),
      notes: null,
      bestE1rmKg: it.bestE1rmKg ?? null,
    })),
  };
  commit(w);
  haptic("medium");
  return w;
}

export function startEmpty(name = "Workout"): ActiveWorkout {
  const w: ActiveWorkout = { id: uuid(), templateId: null, name, day: todayKey(), startedAt: nowIso(), pausedAt: null, pausedSec: 0, rest: null, notes: null, exercises: [] };
  commit(w);
  return w;
}

export function addExercise(ex: Exercise): void {
  update((w) => ({
    ...w,
    exercises: [...w.exercises, { id: uuid(), exerciseId: ex.id, exercise: { id: ex.id, name: ex.name, loadProfile: ex.loadProfile, equipment: ex.equipment, primaryMuscles: ex.primaryMuscles }, supersetGroup: null, prescription: null, previous: null, recommendation: null, sets: setsFromRecommendation(null, null, null), notes: null }],
  }));
}

export function replaceExercise(exerciseRowId: string, ex: Exercise): void {
  update((w) => ({ ...w, exercises: w.exercises.map((e) => (e.id === exerciseRowId ? { ...e, exerciseId: ex.id, exercise: { id: ex.id, name: ex.name, loadProfile: ex.loadProfile, equipment: ex.equipment, primaryMuscles: ex.primaryMuscles }, previous: null, recommendation: null } : e)) }));
}

export function removeExercise(exerciseRowId: string): void {
  update((w) => ({ ...w, exercises: w.exercises.filter((e) => e.id !== exerciseRowId) }));
}

export function addSet(exerciseRowId: string, kind: SetKind = "working"): void {
  update((w) => ({
    ...w,
    exercises: w.exercises.map((e) => {
      if (e.id !== exerciseRowId) return e;
      const last = e.sets.at(-1);
      const weight = kind === "drop" && last ? Math.round(last.weightKg * 0.8 * 2) / 2 : last?.weightKg ?? 0;
      return { ...e, sets: [...e.sets, { id: uuid(), position: e.sets.length, kind, weightKg: weight, reps: last?.reps ?? 8, rir: null, rpe: null, assistedReps: null, completed: false, completedAt: null, targetWeightKg: null, targetReps: null }] };
    }),
  }));
}

export function updateSet(exerciseRowId: string, setId: string, patch: Partial<ActiveSet>): void {
  update(
    (w) => ({ ...w, exercises: w.exercises.map((e) => (e.id === exerciseRowId ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) } : e)) }),
    // Typing changes are persisted locally right away; the server snapshot is sent on completion.
    false,
  );
}

export function removeSet(exerciseRowId: string, setId: string): void {
  update((w) => ({ ...w, exercises: w.exercises.map((e) => (e.id === exerciseRowId ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e)) }));
}

/** One-tap completion: marks the set, starts the rest timer, haptic confirmation. */
export function toggleSetComplete(exerciseRowId: string, setId: string): void {
  let startedRest = false;
  update((w) => {
    const ex = w.exercises.find((e) => e.id === exerciseRowId);
    const set = ex?.sets.find((s) => s.id === setId);
    if (!ex || !set) return w;
    const completing = !set.completed;
    startedRest = completing && set.kind !== "warmup";
    const restSec = ex.prescription?.restSec ?? 120;
    return {
      ...w,
      exercises: w.exercises.map((e) => (e.id === exerciseRowId ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, completed: completing, completedAt: completing ? nowIso() : null } : s)) } : e)),
      rest: startedRest ? { endsAt: Date.now() + restSec * 1000, durationSec: restSec, exerciseId: exerciseRowId } : w.rest,
    };
  });
  haptic(startedRest ? "success" : "light");
}

/**
 * Applies an action sent from the Apple Watch. "complete_set" goes through
 * toggleSetComplete (same rest timer and haptics as a tap on the phone) but is
 * idempotent: a duplicate or late delivery never un-completes a set.
 */
export function applyWatchAction(action: WatchAction): void {
  if (action.type !== "complete_set" || !state) return;
  const set = state.exercises.find((e) => e.id === action.exerciseRowId)?.sets.find((s) => s.id === action.setId);
  if (!set || set.completed) return;
  toggleSetComplete(action.exerciseRowId, action.setId);
}

export function adjustRest(deltaSec: number): void {
  update((w) => (w.rest ? { ...w, rest: { ...w.rest, endsAt: Math.max(Date.now(), w.rest.endsAt + deltaSec * 1000) } } : w), false);
}

export function skipRest(): void {
  update((w) => ({ ...w, rest: null }), false);
}

export function togglePause(): void {
  update((w) => (w.pausedAt ? { ...w, pausedSec: w.pausedSec + (Date.now() - Date.parse(w.pausedAt)) / 1000, pausedAt: null } : { ...w, pausedAt: nowIso(), rest: null }));
}

export function renameWorkout(name: string): void {
  update((w) => ({ ...w, name }));
}

/** Finish: drops never-touched empty sets, queues the completed snapshot, clears local state. Returns the session id. */
export function finishWorkout(): string | null {
  if (!state) return null;
  const w: ActiveWorkout = { ...state, exercises: state.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.completed || s.reps > 0) })).filter((e) => e.sets.some((s) => s.completed)) };
  queueSnapshot(w, "completed");
  kv.set(`workout.finished.${w.id}`, { id: w.id, name: w.name, finishedAt: nowIso() });
  commit(null, false);
  haptic("success");
  return w.id;
}

export function discardWorkout(): void {
  if (!state) return;
  queueSnapshot(state, "discarded");
  commit(null, false);
}

export function elapsedSec(w: ActiveWorkout, now = Date.now()): number {
  const paused = w.pausedSec + (w.pausedAt ? (now - Date.parse(w.pausedAt)) / 1000 : 0);
  return Math.max(0, Math.round((now - Date.parse(w.startedAt)) / 1000 - paused));
}

export function nextIncompleteSet(w: ActiveWorkout): { exerciseRowId: string; setId: string } | null {
  for (const e of w.exercises) for (const s of e.sets) if (!s.completed) return { exerciseRowId: e.id, setId: s.id };
  return null;
}
