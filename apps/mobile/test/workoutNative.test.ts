import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchWorkoutState } from "../src/features/native/types";
import { hapticMock, memory, storageMock } from "./mocks";

const live = { start: vi.fn(), update: vi.fn(), end: vi.fn() };
const watch = { send: vi.fn() };
vi.mock("expo-crypto", () => ({ randomUUID }));
vi.mock("../src/lib/storage", () => storageMock);
vi.mock("../src/lib/haptics", () => hapticMock);
vi.mock("../src/lib/outbox", () => ({ enqueue: () => {} }));
vi.mock("../src/features/native/liveActivity", () => ({ startRestActivity: live.start, updateRestActivity: live.update, endRestActivity: live.end }));
vi.mock("../src/features/native/watch", () => ({ sendWorkoutState: watch.send, onWatchAction: () => ({ remove() {} }) }));

const store = await import("../src/features/workout/store");
const { restActivityInputFromWorkout, watchStateFromWorkout } = await import("../src/features/native/workoutMirror");

const bench = { id: "bench", name: "Bench Press", loadProfile: "barbell", equipment: ["barbell"], primaryMuscles: ["chest"] } as never;
const lastWatchState = () => watch.send.mock.calls.at(-1)?.[0] as WatchWorkoutState | null;

beforeEach(() => {
  store.discardWorkout();
  memory.clear();
  vi.clearAllMocks();
});

describe("native mirrors of the live workout", () => {
  it("mirrors the next set to the watch and starts/updates/ends the rest Live Activity", () => {
    store.startEmpty("Push");
    store.addExercise(bench);
    const ex = store.getActiveWorkout()!.exercises[0]!;
    store.updateSet(ex.id, ex.sets[0]!.id, { weightKg: 80, reps: 8 });
    expect(lastWatchState()).toMatchObject({ workoutName: "Push", exerciseName: "Bench Press", setId: ex.sets[0]!.id, setLabel: "Set 1 of 3", weightKg: 80, reps: 8, restEndsAt: null, completedSets: 0, totalSets: 3 });
    expect(live.start).not.toHaveBeenCalled();

    store.toggleSetComplete(ex.id, ex.sets[0]!.id);
    const rest = store.getActiveWorkout()!.rest!;
    expect(live.start).toHaveBeenCalledTimes(1);
    expect(live.start).toHaveBeenCalledWith({ endsAt: rest.endsAt, exerciseName: "Bench Press", setLabel: "Next: Set 2 of 3" });
    expect(lastWatchState()).toMatchObject({ setId: ex.sets[1]!.id, setLabel: "Set 2 of 3", restEndsAt: rest.endsAt, completedSets: 1 });

    store.adjustRest(30);
    expect(live.update).toHaveBeenCalledWith(expect.objectContaining({ endsAt: rest.endsAt + 30_000 }));

    store.skipRest();
    expect(live.end).toHaveBeenCalledTimes(1);
    expect(lastWatchState()?.restEndsAt).toBeNull();
  });

  it("ends the activity and clears the watch when the workout finishes or is discarded", () => {
    store.startEmpty();
    store.addExercise(bench);
    const ex = store.getActiveWorkout()!.exercises[0]!;
    store.toggleSetComplete(ex.id, ex.sets[0]!.id);
    store.finishWorkout();
    expect(live.end).toHaveBeenCalled();
    expect(lastWatchState()).toBeNull();

    vi.clearAllMocks();
    store.startEmpty();
    store.discardWorkout();
    expect(live.end).toHaveBeenCalled();
    expect(lastWatchState()).toBeNull();
  });

  it("applies complete_set from the watch through toggleSetComplete, idempotently", () => {
    store.startEmpty();
    store.addExercise(bench);
    const ex = store.getActiveWorkout()!.exercises[0]!;
    const action = { type: "complete_set" as const, exerciseRowId: ex.id, setId: ex.sets[0]!.id };
    store.applyWatchAction(action);
    expect(store.getActiveWorkout()!.exercises[0]!.sets[0]!.completed).toBe(true);
    expect(store.getActiveWorkout()!.rest?.durationSec).toBe(120);
    expect(hapticMock.haptic).toHaveBeenCalledWith("success");
    // A duplicate delivery must not un-complete the set.
    store.applyWatchAction(action);
    expect(store.getActiveWorkout()!.exercises[0]!.sets[0]!.completed).toBe(true);
    // Unknown rows are ignored.
    store.applyWatchAction({ ...action, setId: "nope" });
    expect(store.getActiveWorkout()!.exercises[0]!.sets.filter((s) => s.completed)).toHaveLength(1);
  });

  it("reports 'All sets done' when the last set starts the rest", () => {
    store.startEmpty();
    store.addExercise(bench);
    const ex = store.getActiveWorkout()!.exercises[0]!;
    for (const s of ex.sets) store.toggleSetComplete(ex.id, s.id);
    const w = store.getActiveWorkout()!;
    expect(restActivityInputFromWorkout(w)).toEqual({ endsAt: w.rest!.endsAt, exerciseName: "Bench Press", setLabel: "All sets done" });
    expect(watchStateFromWorkout(w)).toMatchObject({ exerciseName: "Bench Press", setId: null, setLabel: null, completedSets: 3, totalSets: 3 });
    expect(watchStateFromWorkout(w, w.rest!.endsAt + 1)?.restEndsAt).toBeNull();
    // The payload stays small and JSON-safe.
    expect(JSON.stringify(watchStateFromWorkout(w)).length).toBeLessThan(400);
  });
});
