import type { ProgressionRecommendation } from "@stoke/core";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartWorkout } from "../src/lib/types";
import { hapticMock, memory, storageMock } from "./mocks";

const enqueued: { method: string; path: string; body: { status: string; exercises: { exerciseId: string; sets: { completed: boolean; weightKg: number }[] }[] } }[] = [];
vi.mock("expo-crypto", () => ({ randomUUID }));
vi.mock("../src/lib/storage", () => storageMock);
vi.mock("../src/lib/haptics", () => hapticMock);
vi.mock("../src/lib/outbox", () => ({ enqueue: (op: (typeof enqueued)[number]) => enqueued.push(op) }));

const store = await import("../src/features/workout/store");

const exercise = (id: string, name: string) => ({ id, slug: id, name, aliases: [], category: "strength", movementPattern: "squat", primaryMuscles: ["quads"], secondaryMuscles: [], equipment: ["barbell"], loadProfile: "barbell", unilateral: false, instructions: [], cues: [], commonMistakes: [], alternatives: [], isCustom: false }) as unknown as StartWorkout["items"][number]["exercise"];
const rx = { scheme: "double_progression", sets: 3, repRange: { min: 6, max: 10 }, targetRir: 2, restSec: 150, loadProfile: "barbell" } as StartWorkout["items"][number]["prescription"];
const rec = (r: Partial<ProgressionRecommendation>): ProgressionRecommendation => ({ action: "increase_load", targetLoadKg: 102.5, targetReps: [6, 6, 6], targetSets: 3, reasons: ["Top of range reached on every set"], confidence: "high", requiresConfirmation: true, ...r });
const previous = { day: "2026-10-26", sets: [0, 1, 2].map(() => ({ weightKg: 100, reps: 10, kind: "working" as const, completed: true })) };

function start(recommendation: ProgressionRecommendation): StartWorkout {
  return { template: { id: "t1", name: "Lower A" }, day: "2026-10-29", readiness: "normal", recoveryInsights: [], shortened: false, items: [{ templateExerciseId: "te1", exercise: exercise("squat", "Back Squat"), supersetGroup: null, prescription: rx, role: "main", previous, recommendation }] };
}

beforeEach(() => {
  store.discardWorkout();
  enqueued.length = 0;
  memory.clear();
});

describe("live workout store", () => {
  it("never pre-applies a load increase; sets start at the previous load until the user accepts", () => {
    const w = store.startFromTemplate(start(rec({})));
    const ex = w.exercises[0]!;
    expect(store.changesLoad(ex.recommendation, ex.previous)).toBe(true);
    expect(ex.sets.map((s) => s.weightKg)).toEqual([100, 100, 100]);
    expect(ex.sets.map((s) => s.reps)).toEqual([10, 10, 10]);

    store.toggleSetComplete(ex.id, ex.sets[0]!.id);
    store.applySuggestion(ex.id);
    const after = store.getActiveWorkout()!.exercises[0]!;
    // The completed set keeps what was lifted; only remaining sets take the suggestion.
    expect(after.sets.map((s) => [s.weightKg, s.completed])).toEqual([[100, true], [102.5, false], [102.5, false]]);
    expect(after.suggestionApplied).toBe(true);
  });

  it("applies rep targets directly when the load does not change", () => {
    const w = store.startFromTemplate(start(rec({ action: "increase_reps", targetLoadKg: 100, targetReps: [11, 11, 10] })));
    expect(w.exercises[0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([[100, 11], [100, 11], [100, 10]]);
  });

  it("starts the prescribed rest after a working set, not after a warm-up", () => {
    const w = store.startEmpty("Test");
    store.addExercise(exercise("bench", "Bench Press") as never);
    const ex = store.getActiveWorkout()!.exercises[0]!;
    store.updateSet(ex.id, ex.sets[0]!.id, { kind: "warmup" });
    store.toggleSetComplete(ex.id, ex.sets[0]!.id);
    expect(store.getActiveWorkout()!.rest).toBeNull();
    store.toggleSetComplete(ex.id, ex.sets[1]!.id);
    expect(store.getActiveWorkout()!.rest?.durationSec).toBe(120);
    store.adjustRest(15);
    store.skipRest();
    expect(store.getActiveWorkout()!.rest).toBeNull();
    expect(w.id).toBe(store.getActiveWorkout()!.id);
  });

  it("persists every change locally so a killed app resumes the session", () => {
    const w = store.startFromTemplate(start(rec({})));
    store.updateSet(w.exercises[0]!.id, w.exercises[0]!.sets[0]!.id, { reps: 7 });
    const saved = storageMock.kv.get<typeof w>("workout.active");
    expect(saved?.exercises[0]!.sets[0]!.reps).toBe(7);
  });

  it("excludes paused time from the elapsed clock", () => {
    const w = { ...store.startEmpty(), startedAt: new Date(0).toISOString(), pausedSec: 60, pausedAt: null };
    expect(store.elapsedSec(w, 600_000)).toBe(540);
  });

  it("finishing queues one completed snapshot without exercises that have no completed sets, then clears local state", () => {
    const w = store.startFromTemplate(start(rec({})));
    store.addExercise(exercise("lunge", "Lunge") as never);
    const ex = w.exercises[0]!;
    store.toggleSetComplete(ex.id, ex.sets[0]!.id);
    enqueued.length = 0;
    const id = store.finishWorkout();
    expect(id).toBe(w.id);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ method: "PUT", path: `/v1/workouts/${w.id}` });
    expect(enqueued[0]!.body.status).toBe("completed");
    expect(enqueued[0]!.body.exercises.map((e) => e.exerciseId)).toEqual(["squat"]);
    expect(store.getActiveWorkout()).toBeNull();
    expect(storageMock.kv.get("workout.active")).toBeNull();
  });
});
