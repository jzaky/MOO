import { describe, expect, it } from "vitest";
import { describePortion, portionForSwap, previewNutrition, rowForFood, rowsFromDraft, toRecipeBody, withQuantity } from "../src/features/recipes/editor";
import type { Food, RecipeDraft } from "../src/lib/types";

const food = (id: string, name: string, per100: Food["per100"], extra: Partial<Food> = {}): Food => ({ id, name, brand: null, barcode: null, source: "usda", sourceLicense: null, isPrivate: false, derivedFromFoodId: null, baseUnit: "g", densityGPerMl: null, per100, servings: [], completeness: 1, quality: { flags: [] }, imageUrl: null, lastVerifiedAt: null, ...extra });
const chicken = food("c", "Chicken breast, roasted", { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 });
const rice = food("r", "Rice, white, cooked", { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 });
const egg = food("e", "Egg, whole", { energyKcal: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 }, { servings: [{ id: "large", label: "large egg", baseAmount: 50, source: "database", isDefault: true, isPrivate: false }] });
const milk = food("m", "Milk", { energyKcal: 61, proteinG: 3.2 }, { baseUnit: "ml" });

const draft: RecipeDraft = {
  name: "Bowls",
  servings: 2,
  sourceUrl: null,
  instructions: [],
  note: "",
  ingredients: [
    { rawText: "400 g chicken", parsed: { quantity: 400, name: "chicken", quantityAssumed: false }, candidates: [{ food: chicken, portion: { kind: "amount", quantity: 400, unit: "g" } }], suggestion: { foodId: "c", portion: { kind: "amount", quantity: 400, unit: "g" } } },
    { rawText: "300 g rice", parsed: { quantity: 300, name: "rice", quantityAssumed: false }, candidates: [{ food: rice, portion: { kind: "amount", quantity: 300, unit: "g" } }], suggestion: { foodId: "r", portion: { kind: "amount", quantity: 300, unit: "g" } } },
    { rawText: "a pinch of saffron", parsed: null, candidates: [], suggestion: null },
  ],
};

describe("recipe editor", () => {
  it("builds rows from the server draft, leaving unmatched lines without a food", () => {
    const rows = rowsFromDraft(draft);
    expect(rows.map((r) => [r.food?.id ?? null, r.portion?.quantity ?? null])).toEqual([["c", 400], ["r", 300], [null, null]]);
  });

  it("previews per-serving nutrition with the shared core maths and lists what is not counted", () => {
    const p = previewNutrition(rowsFromDraft(draft), 2, null)!;
    // (400 g × 165 + 300 g × 130) / 100 / 2 servings
    expect(p.perServing.energyKcal).toBe(Math.round((4 * 165 + 3 * 130) / 2));
    expect(p.perServing.proteinG).toBe(Math.round((4 * 31 + 3 * 2.7) / 2));
    expect(p.counted).toBe(2);
    expect(p.notCounted).toEqual(["a pinch of saffron"]);
    expect(previewNutrition(rowsFromDraft(draft), 0, null)).toBeNull();
  });

  it("does not count an amount that cannot be converted, instead of guessing a density", () => {
    const rows = [{ ...rowForFood(milk), portion: { kind: "amount" as const, quantity: 200, unit: "g" as const } }];
    expect(previewNutrition(rows, 1, null)!.notCounted).toHaveLength(1);
  });

  it("keeps a compatible amount when swapping foods, otherwise falls back without converting", () => {
    expect(portionForSwap(rice, { kind: "amount", quantity: 250, unit: "g" }, null)).toEqual({ kind: "amount", quantity: 250, unit: "g" });
    expect(portionForSwap(milk, { kind: "amount", quantity: 250, unit: "g" }, null)).toEqual({ kind: "amount", quantity: 100, unit: "ml" });
    expect(portionForSwap(egg, null, { kind: "serving", servingId: "large", quantity: 2 })).toEqual({ kind: "serving", servingId: "large", quantity: 2 });
  });

  it("describes and edits portions", () => {
    const row = { ...rowForFood(egg), portion: { kind: "serving" as const, servingId: "large", quantity: 2 } };
    expect(describePortion(row)).toBe("2 × large egg");
    expect(withQuantity(row, 3).portion).toEqual({ kind: "serving", servingId: "large", quantity: 3 });
  });

  it("asks for an amount when the matched food has none, then counts it", () => {
    const row = { ...rowForFood(chicken), portion: null };
    expect(previewNutrition([row], 1, null)!.notCounted).toEqual([row.rawText]);
    const filled = withQuantity(row, 150);
    expect(filled.portion).toEqual({ kind: "amount", quantity: 150, unit: "g" });
    expect(previewNutrition([filled], 1, null)!.perServing.energyKcal).toBe(Math.round(1.5 * 165));
  });

  it("sends unmatched lines without a food so the server counts them as missing", () => {
    const body = toRecipeBody({ name: "  Bowls ", servings: 2, cookedYieldG: null, instructions: " ", sourceUrl: null, rows: rowsFromDraft(draft) });
    expect(body.name).toBe("Bowls");
    expect(body.instructions).toBeNull();
    expect(body.ingredients[2]).toEqual({ foodId: null, rawText: "a pinch of saffron", portion: null });
    expect(body.ingredients[0]).toMatchObject({ foodId: "c", portion: { kind: "amount", quantity: 400, unit: "g" } });
  });
});
