import { describe, expect, it } from "vitest";
import {
  checkEnergyConsistency,
  computeRecipeNutrition,
  energyFromMacros,
  generateTargets,
  mifflinStJeor,
  nutrientsForPortion,
  perServingToPer100,
  portionToBaseAmount,
  PortionError,
  scalePer100,
  scaleRecipe,
  sumNutrients,
  summarizeDay,
  remainingInsight,
  totalsToValues,
  type FoodNutritionBasis,
} from "../src";

const chicken: FoodNutritionBasis = {
  baseUnit: "g",
  per100: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0, sodiumMg: 74 },
  servings: [{ id: "breast", label: "1 breast", baseAmount: 172 }],
};
const milk: FoodNutritionBasis = {
  baseUnit: "ml",
  per100: { energyKcal: 64, proteinG: 3.3, carbsG: 4.8, fatG: 3.6 },
  servings: [{ id: "cup", label: "1 cup", baseAmount: 240 }],
  densityGPerMl: 1.03,
};
const toast: FoodNutritionBasis = {
  baseUnit: "g",
  per100: { energyKcal: 265, proteinG: 9, carbsG: 49, fatG: 3.2, fiberG: null },
  servings: [{ id: "slice", label: "1 slice", baseAmount: 28 }],
};

describe("portions and serving conversions", () => {
  it("scales per-100 g values to a weight", () => {
    const v = scalePer100(chicken.per100, 200);
    expect(v.energyKcal).toBeCloseTo(330);
    expect(v.proteinG).toBeCloseTo(62);
  });

  it("resolves servings × quantity", () => {
    expect(portionToBaseAmount(chicken, { kind: "serving", servingId: "breast", quantity: 1.5 })).toBeCloseTo(258);
  });

  it("converts imperial mass to grams", () => {
    expect(portionToBaseAmount(chicken, { kind: "amount", quantity: 4, unit: "oz" })).toBeCloseTo(113.398, 2);
  });

  it("converts volume to grams only when density is known", () => {
    expect(() => portionToBaseAmount(chicken, { kind: "amount", quantity: 1, unit: "cup" })).toThrow(PortionError);
    expect(portionToBaseAmount(milk, { kind: "amount", quantity: 103, unit: "g" })).toBeCloseTo(100);
    expect(portionToBaseAmount(milk, { kind: "amount", quantity: 2, unit: "tbsp" })).toBe(30);
  });

  it("rejects non-positive and non-finite quantities", () => {
    expect(() => portionToBaseAmount(chicken, { kind: "amount", quantity: 0, unit: "g" })).toThrow(PortionError);
    expect(() => portionToBaseAmount(chicken, { kind: "amount", quantity: Number.NaN, unit: "g" })).toThrow(PortionError);
    expect(() => portionToBaseAmount(chicken, { kind: "serving", servingId: "nope", quantity: 1 })).toThrow(PortionError);
  });

  it("converts label per-serving values to per-100", () => {
    const per100 = perServingToPer100({ energyKcal: 120, proteinG: 24 }, 30);
    expect(per100.energyKcal).toBeCloseTo(400);
    expect(per100.proteinG).toBeCloseTo(80);
  });
});

describe("missing nutrient handling", () => {
  it("never treats unknown values as zero", () => {
    const a = nutrientsForPortion(toast, { kind: "serving", servingId: "slice", quantity: 2 }).nutrients;
    const b = nutrientsForPortion(chicken, { kind: "amount", quantity: 150, unit: "g" }).nutrients;
    const totals = sumNutrients([a, b]);
    expect(totals.fiberG).toEqual({ value: 0, missing: 1, known: 1 });
    expect(totals.sugarG.known).toBe(0);
    const values = totalsToValues(totals);
    expect(values.sugarG).toBeNull();
    expect(values.fiberG).toBe(0);
  });

  it("macro energy is null when any macro is unknown", () => {
    expect(energyFromMacros({ proteinG: 10, carbsG: null, fatG: 1 })).toBeNull();
    expect(energyFromMacros({ proteinG: 10, carbsG: 10, fatG: 10 })).toBe(170);
  });

  it("flags records whose energy disagrees with their macros", () => {
    expect(checkEnergyConsistency({ energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }).ok).toBe(true);
    expect(checkEnergyConsistency({ energyKcal: 500, proteinG: 31, carbsG: 0, fatG: 3.6 }).ok).toBe(false);
    expect(checkEnergyConsistency({ energyKcal: null, proteinG: 1, carbsG: 1, fatG: 1 }).ok).toBe(true);
  });
});

describe("recipes", () => {
  it("computes totals, per-serving and per-100 g cooked", () => {
    const r = computeRecipeNutrition(
      [
        { food: chicken, portion: { kind: "amount", quantity: 500, unit: "g" } },
        { food: milk, portion: { kind: "serving", servingId: "cup", quantity: 1 } },
      ],
      4,
      600,
    );
    expect(r.total.energyKcal).toBeCloseTo(825 + 153.6);
    expect(r.perServing.energyKcal).toBeCloseTo((825 + 153.6) / 4);
    expect(r.per100gCooked!.energyKcal).toBeCloseTo((825 + 153.6) / 6);
    expect(r.rawWeightG).toBeCloseTo(500 + 240 * 1.03);
  });

  it("scales ingredient quantities", () => {
    const scaled = scaleRecipe([{ portion: { kind: "amount" as const, quantity: 300, unit: "g" as const } }], 4, 2);
    expect(scaled[0]!.portion.quantity).toBe(150);
  });

  it("rejects zero servings", () => {
    expect(() => computeRecipeNutrition([], 0)).toThrow(RangeError);
  });
});

describe("starting targets", () => {
  const body = { sex: "male" as const, ageYears: 35, heightCm: 180, weightKg: 85 };

  it("matches Mifflin-St Jeor", () => {
    expect(mifflinStJeor(body)).toBeCloseTo(10 * 85 + 6.25 * 180 - 5 * 35 + 5);
  });

  it("creates a moderate deficit for fat loss and labels it an estimate", () => {
    const t = generateTargets(body, "moderate", { goal: "lose_fat" });
    expect(t.basis).toBe("estimated");
    expect(t.energyKcal).toBeLessThan(t.estimatedTdeeKcal);
    expect(t.energyKcal).toBeGreaterThan(t.estimatedTdeeKcal * 0.75);
    expect(t.proteinG).toBe(170);
    const kcal = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
    expect(Math.abs(kcal - t.energyKcal)).toBeLessThan(25);
  });

  it("clamps an aggressive loss rate", () => {
    const t = generateTargets(body, "sedentary", { goal: "lose_fat", weeklyRatePct: -0.03 });
    expect(t.weeklyRatePct).toBe(-0.01);
    expect(t.notes.join(" ")).toMatch(/limited/);
    expect(t.energyKcal).toBeGreaterThanOrEqual(1500);
  });

  it("never goes below the calorie floor", () => {
    const small = { sex: "female" as const, ageYears: 60, heightCm: 150, weightKg: 45 };
    const t = generateTargets(small, "sedentary", { goal: "lose_fat", weeklyRatePct: -0.01 });
    expect(t.energyKcal).toBeGreaterThanOrEqual(Math.min(1200, t.estimatedTdeeKcal) - 10);
  });

  it("validates inputs", () => {
    expect(() => generateTargets({ ...body, heightCm: 20 }, "light", { goal: "maintain" })).toThrow(RangeError);
  });
});

describe("daily diary", () => {
  it("summarizes meals and remaining macros", () => {
    const s = summarizeDay(
      [
        { id: "1", meal: "breakfast", nutrients: { energyKcal: 400, proteinG: 30, carbsG: 40, fatG: 12 }, loggedAt: "" },
        { id: "2", meal: "lunch", nutrients: { energyKcal: 600, proteinG: 45, carbsG: 50, fatG: 20, fiberG: null }, loggedAt: "" },
      ],
      { energyKcal: 2200, proteinG: 120, carbsG: 220, fatG: 70, fiberG: 30 },
    );
    expect(s.meals.map((m) => m.meal)).toEqual(["breakfast", "lunch", "dinner", "snacks"]);
    const protein = s.progress.find((p) => p.key === "proteinG")!;
    expect(protein.remaining).toBe(45);
    expect(remainingInsight(protein, "g", "protein")).toBe("About 45 g of protein remaining today.");
    const fiber = s.progress.find((p) => p.key === "fiberG")!;
    expect(fiber.missingEntries).toBe(2);
    expect(remainingInsight(fiber, "g", "fibre")).toMatch(/lack this value/);
  });
});
