import { describe, expect, it } from "vitest";
import { assessFatigue, blockPosition, deloadRecommendation, DEFAULT_PROFILES, isDeloadWeek, platesToLoad, STANDARD_BARBELL, type LoggedSet, type ProgressionRecommendation } from "../src";

const set = (weightKg: number, reps: number): LoggedSet => ({ weightKg, reps, kind: "working", completed: true });
const session = (day: string, kg: number, reps = 5) => ({ day, sets: [set(kg, reps), set(kg, reps)] });

describe("training blocks", () => {
  it("counts weeks within the block and marks the last as deload", () => {
    expect(blockPosition("2026-10-05", 5, "2026-10-05")).toEqual({ week: 1, of: 5, deload: false });
    expect(blockPosition("2026-10-05", 5, "2026-11-02")).toEqual({ week: 5, of: 5, deload: true });
    expect(blockPosition("2026-10-05", 5, "2026-11-09")).toEqual({ week: 1, of: 5, deload: false });
    expect(blockPosition("2026-10-05", null, "2026-11-09")).toBeNull();
    expect(blockPosition("2026-10-05", 2, "2026-11-09")).toBeNull();
  });
  it("honours a one-off scheduled deload week", () => {
    expect(isDeloadWeek("2026-10-30", null, "2026-10-26")).toBe(true);
    expect(isDeloadWeek("2026-11-02", null, "2026-10-26")).toBe(false);
  });
  it("cuts volume, eases effort and suggests a lighter achievable load, still needing confirmation", () => {
    const rec: ProgressionRecommendation = { action: "increase_load", targetLoadKg: 100, targetReps: [5, 5, 5, 5, 5], targetSets: 5, reasons: ["Top of range reached"], confidence: "high", requiresConfirmation: true };
    const d = deloadRecommendation(rec, 5, 2, DEFAULT_PROFILES.barbell);
    expect(d).toMatchObject({ action: "deload", targetSets: 3, targetRir: 4, requiresConfirmation: true });
    expect(d.targetLoadKg).toBeLessThan(100);
    expect(d.targetLoadKg! % 2.5).toBe(0);
    expect(d.targetReps).toHaveLength(3);
  });
});

describe("fatigue", () => {
  const falling = (name: string) => ({ exerciseName: name, sessions: [session("2026-10-01", 100), session("2026-10-05", 102.5), session("2026-10-09", 95)] });
  const steady = (name: string) => ({ exerciseName: name, sessions: [session("2026-10-01", 100), session("2026-10-05", 100), session("2026-10-09", 100)] });
  it("suggests a deload when two lifts regress, with the evidence", () => {
    const a = assessFatigue([falling("Squat"), falling("Bench"), steady("Row")]);
    expect(a.suggestDeload).toBe(true);
    expect(a.regressingLifts).toEqual(["Squat", "Bench"]);
    expect(a.reasons[0]).toMatch(/Squat, Bench/);
  });
  it("needs poor recovery to act on a single regressing lift, and ignores flat performance", () => {
    expect(assessFatigue([falling("Squat"), steady("Bench")]).suggestDeload).toBe(false);
    expect(assessFatigue([falling("Squat"), steady("Bench")], "poor").suggestDeload).toBe(true);
    expect(assessFatigue([steady("Squat"), steady("Bench")], "poor").suggestDeload).toBe(false);
  });
});

describe("plate calculator", () => {
  it("loads kg plates per side", () => {
    expect(platesToLoad(STANDARD_BARBELL.kg, 100)).toEqual({ total: 100, plates: [25, 15], exact: true });
    expect(platesToLoad(STANDARD_BARBELL.kg, 20)).toEqual({ total: 20, plates: [], exact: true });
    expect(platesToLoad(STANDARD_BARBELL.kg, 62.5)).toEqual({ total: 62.5, plates: [20, 1.25], exact: true });
  });
  it("loads lb plates and falls back to the closest loadable weight", () => {
    expect(platesToLoad(STANDARD_BARBELL.lb, 225)).toEqual({ total: 225, plates: [45, 45], exact: true });
    expect(platesToLoad(STANDARD_BARBELL.lb, 137)).toEqual({ total: 135, plates: [45], exact: false });
    expect(platesToLoad(STANDARD_BARBELL.kg, 10)).toBeNull();
  });
});
