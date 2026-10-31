import { describe, expect, it } from "vitest";
import { focusPosition, previousFor, recordFor, upNext, weightStep } from "../src/features/workout/focus";
import type { ActiveExercise, ActiveSet, ActiveWorkout } from "../src/features/workout/store";

let n = 0;
const set = (weightKg: number, reps: number, completed = false, kind: ActiveSet["kind"] = "working"): ActiveSet => ({ id: `s${n++}`, position: n, kind, weightKg, reps, rir: null, rpe: null, assistedReps: null, completed, completedAt: null, targetWeightKg: null, targetReps: null });
const ex = (name: string, sets: ActiveSet[], extra: Partial<ActiveExercise> = {}): ActiveExercise => ({ id: name, exerciseId: name, exercise: { id: name, name, loadProfile: "barbell", equipment: ["barbell"], primaryMuscles: [] } as unknown as ActiveExercise["exercise"], supersetGroup: null, prescription: null, previous: null, recommendation: null, sets, notes: null, ...extra });
const workout = (exercises: ActiveExercise[]): ActiveWorkout => ({ id: "w", templateId: null, name: "Upper A", day: "2026-10-31", startedAt: "2026-10-31T14:00:00Z", pausedAt: null, pausedSec: 0, exercises, rest: null, notes: null });

describe("workout focus", () => {
  it("points at the first unfinished set and counts working sets only", () => {
    const bench = ex("bench", [set(40, 8, true, "warmup"), set(80, 8, true), set(80, 8), set(80, 8)]);
    const row = ex("row", [set(70, 10)]);
    const f = focusPosition(workout([bench, row]))!;
    expect(f.exercise.id).toBe("bench");
    expect([f.workingNumber, f.workingTotal]).toEqual([2, 3]);
    expect(upNext(workout([bench, row]))!.set.id).toBe(bench.sets[3]!.id);
  });

  it("moves to the next exercise and ends when everything is done", () => {
    const bench = ex("bench", [set(80, 8, true)]);
    const row = ex("row", [set(70, 10)]);
    expect(focusPosition(workout([bench, row]))!.exercise.id).toBe("row");
    expect(upNext(workout([bench, row]))).toBeNull();
    expect(focusPosition(workout([ex("bench", [set(80, 8, true)])]))).toBeNull();
  });

  it("matches last session's set by working-set position", () => {
    const e = ex("bench", [], { previous: { day: "2026-10-28", sets: [{ kind: "warmup", weightKg: 40, reps: 8, completed: true }, { kind: "working", weightKg: 80, reps: 7, completed: true }, { kind: "working", weightKg: 80, reps: 6, completed: true }] } });
    expect(previousFor(e, 2)).toEqual({ weightKg: 80, reps: 6 });
    expect(previousFor(e, 3)).toBeNull();
  });
});

describe("live record cue", () => {
  const prev = { day: "2026-10-28", sets: [{ kind: "working" as const, weightKg: 80, reps: 7, completed: true }] };
  it("fires when the set beats the all-time best, not just last session", () => {
    // Last session e1RM 98.7; all-time best 105: 80 x 9 (104) beats last time but is not a record.
    expect(recordFor(ex("bench", [], { previous: prev, bestE1rmKg: 105 }), set(80, 9))).toBeNull();
    const r = recordFor(ex("bench", [], { previous: prev, bestE1rmKg: 105 }), set(85, 9))!;
    expect(r.previousKg).toBe(105);
    expect(r.e1rmKg).toBeCloseTo(85 * 1.3, 5);
  });

  it("counts sets already done today, so the same weight doesn't fire twice", () => {
    const done = set(90, 8, true);
    const e = ex("bench", [done], { previous: prev, bestE1rmKg: 100 });
    expect(recordFor(e, set(90, 8))).toBeNull();
  });

  it("stays quiet on a first-ever session, warm-ups and very high reps", () => {
    expect(recordFor(ex("bench", []), set(100, 5))).toBeNull();
    expect(recordFor(ex("bench", [], { bestE1rmKg: 50 }), set(100, 5, false, "warmup"))).toBeNull();
    expect(recordFor(ex("bench", [], { bestE1rmKg: 50 }), set(60, 20))).toBeNull();
  });

  it("steps weight by the equipment and unit", () => {
    expect(weightStep(ex("bench", []), "metric")).toBe(2.5);
    expect(weightStep(ex("db", [], { exercise: { id: "db", name: "DB press", loadProfile: "dumbbell", equipment: ["dumbbell"], primaryMuscles: [] } as unknown as ActiveExercise["exercise"] }), "metric")).toBe(2);
    expect(weightStep(ex("bench", []), "imperial")).toBe(5);
  });
});
