import { describe, expect, it } from "vitest";
import { goalForecast } from "../src/features/progress/forecast";
import { heatLevel, muscleRows, plannedSetsPerMuscle } from "../src/features/progress/muscles";

describe("planned sets per muscle", () => {
  it("counts primary muscles fully and secondary as half, across days", () => {
    const bench = { exercise: { primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "front_delts"] }, prescription: { sets: 4 } };
    const dips = { exercise: { primaryMuscles: ["triceps"], secondaryMuscles: ["chest"] }, prescription: { sets: 3 } };
    expect(plannedSetsPerMuscle([{ exercises: [bench, dips] }, { exercises: [bench] }])).toEqual({ chest: 9.5, triceps: 7, front_delts: 4 });
  });

  it("rows sort by plan and mark unplanned muscles", () => {
    const rows = muscleRows({ chest: 6, calves: 2 }, { chest: 12, quads: 10 });
    expect(rows.map((r) => [r.muscle, r.done, r.planned])).toEqual([["chest", 6, 12], ["quads", 0, 10], ["calves", 2, 0]]);
    expect(rows.map((r) => heatLevel(r.ratio))).toEqual([2, 0, null]);
    expect(heatLevel(1.2)).toBe(4);
  });
});

describe("goal forecast", () => {
  const base = { trendKg: 84.4, goalKg: 80, kgPerWeek: -0.5, sufficiency: "good" as const, today: "2026-10-31" };
  it("projects the date at the current pace with a ±25% pace range", () => {
    const f = goalForecast(base)!;
    expect(f.weeks).toBeCloseTo(8.8, 5);
    expect(f.day).toBe("2027-01-01");
    expect(f.earliest < f.day && f.day < f.latest).toBe(true);
  });
  it("says nothing when the pace is unknown, flat, wrong way or too far out", () => {
    expect(goalForecast({ ...base, sufficiency: "insufficient" })).toBeNull();
    expect(goalForecast({ ...base, kgPerWeek: 0.01 })).toBeNull();
    expect(goalForecast({ ...base, kgPerWeek: 0.3 })).toBeNull();
    expect(goalForecast({ ...base, goalKg: 60, kgPerWeek: -0.2 })).toBeNull();
    expect(goalForecast({ ...base, goalKg: null })).toBeNull();
  });
});
