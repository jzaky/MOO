import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILES,
  detectPersonalRecords,
  estimateOneRepMax,
  nextLoadDown,
  nextLoadUp,
  platesPerSide,
  recommendProgression,
  roundToAchievable,
  summarizeWorkout,
  weeklySetsPerMuscle,
  type LoggedSet,
  type Prescription,
  type SessionPerformance,
} from "../src";

const w = (weightKg: number, reps: number, extra: Partial<LoggedSet> = {}): LoggedSet => ({ weightKg, reps, kind: "working", completed: true, ...extra });

const inclineDb: Prescription = {
  scheme: "double_progression",
  sets: 3,
  repRange: { min: 8, max: 12 },
  targetRir: 2,
  loadProfile: DEFAULT_PROFILES.dumbbell,
};

describe("equipment increments", () => {
  it("steps through the available dumbbells", () => {
    expect(nextLoadUp(DEFAULT_PROFILES.dumbbell, 30)).toBe(32);
    expect(nextLoadDown(DEFAULT_PROFILES.dumbbell, 30)).toBe(28);
    expect(roundToAchievable(DEFAULT_PROFILES.dumbbell, 31)).toBe(30);
  });
  it("uses 2× the smallest plate for barbells", () => {
    expect(nextLoadUp(DEFAULT_PROFILES.barbell, 100)).toBe(102.5);
    expect(platesPerSide(DEFAULT_PROFILES.barbell, 102.5)).toEqual([25, 15, 1.25]);
    expect(platesPerSide(DEFAULT_PROFILES.barbell, 101)).toBeNull();
  });
  it("has no load steps for bodyweight", () => {
    expect(nextLoadUp(DEFAULT_PROFILES.bodyweight, 0)).toBeNull();
  });
});

describe("strength estimates", () => {
  it("Epley with RIR adjustment and a reliability cutoff", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimateOneRepMax(100, 8, 2)).toBeCloseTo(133.33, 1);
    expect(estimateOneRepMax(50, 20)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
  });
});

describe("progressive overload engine", () => {
  const prev: SessionPerformance = { day: "2026-10-20", sets: [w(30, 10), w(30, 10), w(30, 9)] };
  const curr: SessionPerformance = { day: "2026-10-24", sets: [w(30, 12), w(30, 12), w(30, 11)] };

  it("spec example: strict rules ask for one more rep before adding load", () => {
    const r = recommendProgression(inclineDb, [prev, curr], { today: "2026-10-28" });
    expect(r.action).toBe("increase_reps");
    expect(r.targetLoadKg).toBe(30);
    expect(r.targetReps).toEqual([12, 12, 12]);
    expect(r.requiresConfirmation).toBe(true);
  });

  it("spec example: with a 1-rep shortfall allowance it suggests the next dumbbell", () => {
    const r = recommendProgression({ ...inclineDb, allowShortfall: 1 }, [prev, curr], { today: "2026-10-28" });
    expect(r.action).toBe("increase_load");
    expect(r.targetLoadKg).toBe(32);
    expect(r.targetReps).toEqual([8, 8, 8]);
    expect(r.reasons.join(" ")).toMatch(/32 kg/);
  });

  it("adds load once every set hits the top of the range", () => {
    const r = recommendProgression(inclineDb, [{ day: "2026-10-24", sets: [w(30, 12), w(30, 12), w(30, 12)] }], { today: "2026-10-27" });
    expect(r.action).toBe("increase_load");
    expect(r.targetLoadKg).toBe(32);
  });

  it("holds load when recovery is poor", () => {
    const r = recommendProgression(inclineDb, [{ day: "2026-10-24", sets: [w(30, 12), w(30, 12), w(30, 12)] }], { today: "2026-10-27", readiness: "poor" });
    expect(r.action).toBe("maintain");
    expect(r.targetLoadKg).toBe(30);
  });

  it("repeats after one session below the rep floor, reduces after two", () => {
    const fail1 = { day: "2026-10-20", sets: [w(32, 8), w(32, 7), w(32, 6)] };
    const fail2 = { day: "2026-10-24", sets: [w(32, 8), w(32, 6), w(32, 6)] };
    expect(recommendProgression(inclineDb, [fail1], { today: "2026-10-22" }).action).toBe("maintain");
    const r = recommendProgression(inclineDb, [fail1, fail2], { today: "2026-10-27" });
    expect(r.action).toBe("reduce_load");
    expect(r.targetLoadKg).toBe(30);
  });

  it("suggests a deload after a stall", () => {
    const s = (day: string, reps: number[]) => ({ day, sets: reps.map((r) => w(32, r)) });
    const history = [s("2026-09-01", [10, 9, 9]), s("2026-09-05", [9, 9, 9]), s("2026-09-09", [10, 9, 8]), s("2026-09-13", [9, 9, 9])];
    const r = recommendProgression(inclineDb, history, { today: "2026-09-16" });
    expect(r.action).toBe("deload");
    expect(r.targetLoadKg).toBe(28);
    expect(r.targetSets).toBe(2);
  });

  it("re-acclimates after a long layoff", () => {
    const r = recommendProgression(inclineDb, [{ day: "2026-08-01", sets: [w(30, 12), w(30, 12), w(30, 12)] }], { today: "2026-10-01" });
    expect(r.action).toBe("reduce_load");
    expect(r.targetLoadKg).toBe(27.5);
  });

  it("establishes a baseline with no history and ignores warm-ups", () => {
    expect(recommendProgression(inclineDb, [], { today: "2026-10-01" }).action).toBe("establish_baseline");
    const onlyWarmups = { day: "2026-09-30", sets: [w(10, 15, { kind: "warmup" })] };
    expect(recommendProgression(inclineDb, [onlyWarmups], { today: "2026-10-01" }).action).toBe("establish_baseline");
  });

  it("linear progression on a barbell", () => {
    const squat: Prescription = { scheme: "linear", sets: 3, repRange: { min: 5, max: 5 }, loadProfile: DEFAULT_PROFILES.barbell, linearIncrementKg: 2.5 };
    const ok = recommendProgression(squat, [{ day: "2026-10-20", sets: [w(100, 5), w(100, 5), w(100, 5)] }], { today: "2026-10-22" });
    expect(ok).toMatchObject({ action: "increase_load", targetLoadKg: 102.5 });
    const miss = recommendProgression(squat, [{ day: "2026-10-20", sets: [w(100, 5), w(100, 5)] }], { today: "2026-10-22" });
    expect(miss.action).toBe("maintain");
  });

  it("RPE-target scheme caps increases at 5%", () => {
    const p: Prescription = { scheme: "rpe_target", sets: 3, repRange: { min: 6, max: 6 }, targetRir: 2, loadProfile: DEFAULT_PROFILES.barbell };
    const r = recommendProgression(p, [{ day: "2026-10-20", sets: [w(100, 10, { rir: 0 })] }], { today: "2026-10-22" });
    expect(r.targetLoadKg).toBeLessThanOrEqual(105);
    expect(r.action).toBe("increase_load");
  });

  it("validates prescriptions", () => {
    expect(() => recommendProgression({ ...inclineDb, repRange: { min: 10, max: 8 } }, [], { today: "2026-10-01" })).toThrow(RangeError);
  });
});

describe("training analytics", () => {
  it("detects PRs relative to history only", () => {
    const prior = [{ exerciseId: "bench", day: "2026-10-01", sets: [w(80, 8), w(80, 7)] }];
    const prs = detectPersonalRecords(prior, { exerciseId: "bench", day: "2026-10-08", sets: [w(82.5, 8), w(80, 9), w(20, 20, { kind: "warmup" })] });
    expect(prs.map((p) => p.kind).sort()).toEqual(["best_set_volume", "e1rm", "heaviest_weight", "most_reps_at_weight"]);
    expect(detectPersonalRecords([], { exerciseId: "bench", day: "2026-10-08", sets: [w(80, 8)] })).toEqual([]);
  });

  it("counts weekly sets per muscle with half credit for secondary", () => {
    const weeks = weeklySetsPerMuscle(
      [
        { exerciseId: "bench", day: "2026-10-26", sets: [w(80, 8), w(80, 8), w(40, 10, { kind: "warmup" })] },
        { exerciseId: "row", day: "2026-10-28", sets: [w(60, 10), w(60, 10), w(60, 10)] },
      ],
      (id) => (id === "bench" ? { primary: ["chest"], secondary: ["triceps", "front_delts"] } : { primary: ["lats"], secondary: ["biceps"] }),
    );
    const wk = weeks.get("2026-10-26")!;
    expect(wk.get("chest")).toBe(2);
    expect(wk.get("triceps")).toBe(1);
    expect(wk.get("biceps")).toBe(1.5);
  });

  it("summarizes a workout excluding pauses and warm-ups", () => {
    const s = summarizeWorkout(new Date("2026-10-28T10:00:00Z"), new Date("2026-10-28T11:00:00Z"), [[w(80, 8), w(40, 10, { kind: "warmup" })], [w(60, 10, { completed: false })]], 300);
    expect(s).toEqual({ durationSec: 3300, exercises: 1, workSets: 1, totalReps: 8, volumeKg: 640 });
  });
});

import { suggestSplit } from "../src";
describe("split suggestion", () => {
  it("chooses structure by availability and caps beginners", () => {
    expect(suggestSplit([1, 3, 5], "beginner").split).toBe("full_body");
    expect(suggestSplit([1, 2, 4, 5], "intermediate")).toMatchObject({ split: "upper_lower", weekdays: [1, 2, 4, 5] });
    const b = suggestSplit([1, 2, 3, 4, 5, 6], "beginner");
    expect(b.daysPerWeek).toBe(4);
    expect(suggestSplit([1, 2, 3, 4, 5, 6], "advanced").split).toBe("push_pull_legs");
    expect(suggestSplit([], "new").weekdays).toEqual([1, 3, 5]);
  });
});
