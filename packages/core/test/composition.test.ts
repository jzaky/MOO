import { describe, expect, it } from "vitest";
import { navyBodyFat } from "../src";

describe("US Navy body-fat estimate", () => {
  it("matches hand-computed values for both formulas", () => {
    // 495 / (1.0324 − 0.19077·log10(90 − 38) + 0.15456·log10(180)) − 450
    const m = 495 / (1.0324 - 0.19077 * Math.log10(52) + 0.15456 * Math.log10(180)) - 450;
    expect(navyBodyFat({ sex: "male", heightCm: 180, waistCm: 90, neckCm: 38 })!.percent).toBe(Math.round(m * 10) / 10);
    const f = 495 / (1.29579 - 0.35004 * Math.log10(76 + 100 - 33) + 0.221 * Math.log10(165)) - 450;
    expect(navyBodyFat({ sex: "female", heightCm: 165, waistCm: 76, neckCm: 33, hipCm: 100 })!.percent).toBe(Math.round(f * 10) / 10);
  });
  it("lands in a sensible range for typical people", () => {
    const m = navyBodyFat({ sex: "male", heightCm: 180, waistCm: 90, neckCm: 38 })!.percent;
    expect(m).toBeGreaterThan(15);
    expect(m).toBeLessThan(25);
  });
  it("returns nothing rather than guessing when inputs are missing or implausible", () => {
    expect(navyBodyFat({ sex: "female", heightCm: 165, waistCm: 76, neckCm: 33 })).toBeNull();
    expect(navyBodyFat({ sex: "male", heightCm: 180, waistCm: 35, neckCm: 38 })).toBeNull();
    expect(navyBodyFat({ sex: "male", heightCm: 18, waistCm: 90, neckCm: 38 })).toBeNull();
  });
});
