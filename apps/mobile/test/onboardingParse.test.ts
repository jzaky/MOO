import { describe, expect, it } from "vitest";
import { bodyProblems, metricHeightCm, normalizeTime, parseNumber } from "../src/features/onboarding/parse";

describe("onboarding input parsing", () => {
  it("reads numbers the way phones type them", () => {
    expect(parseNumber("82,5")).toBe(82.5);
    expect(parseNumber(" 15 %")).toBe(15);
    expect(parseNumber("")).toBeNaN();
    expect(metricHeightCm("1.78")).toBe(178);
    expect(metricHeightCm("1,8")).toBe(180);
    expect(metricHeightCm("178")).toBe(178);
  });
  it("normalizes times", () => {
    expect(normalizeTime("11pm")).toBe("23:00");
    expect(normalizeTime("7:30 am")).toBe("07:30");
    expect(normalizeTime("12 am")).toBe("00:00");
    expect(normalizeTime("12pm")).toBe("12:00");
    expect(normalizeTime("23.00")).toBe("23:00");
    expect(normalizeTime("2300")).toBe("23:00");
    expect(normalizeTime("7")).toBe("07:00");
    expect(normalizeTime("25:00")).toBeNull();
    expect(normalizeTime("late")).toBeNull();
  });
  it("names what's wrong with the body step", () => {
    const ok = { birthYear: "1990", birthMonth: "5", birthDay: "14", heightCm: 178, weightKg: 82, bodyFat: "" };
    const today = new Date("2026-10-31T00:00:00Z");
    expect(bodyProblems(ok, today)).toEqual([]);
    expect(bodyProblems({ ...ok, birthMonth: "2", birthDay: "31" }, today)).toEqual(["birth_date"]);
    expect(bodyProblems({ ...ok, birthYear: "2020" }, today)).toEqual(["age"]);
    expect(bodyProblems({ ...ok, heightCm: 5.8 }, today)).toEqual(["height"]);
    expect(bodyProblems({ ...ok, weightKg: 8 }, today)).toEqual(["weight"]);
    expect(bodyProblems({ ...ok, bodyFat: "15%" }, today)).toEqual([]);
    expect(bodyProblems({ ...ok, bodyFat: "0.15" }, today)).toEqual(["body_fat"]);
  });
});
