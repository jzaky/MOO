import { describe, expect, it } from "vitest";
import { composeDish, dietFlags, STANDARD_DISHES, type NutrientValues } from "../src";

describe("standard-recipe dishes", () => {
  const labneh = STANDARD_DISHES.find((d) => d.slug === "labneh")!;
  const usda = new Map<string, NutrientValues>([
    ["171304", { energyKcal: 97, proteinG: 9, carbsG: 3.98, fatG: 5, fiberG: 0 }],
    ["171413", { energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100 }],
  ]);

  it("computes per-100 g from ingredient weights", () => {
    const c = composeDish(labneh, usda);
    expect(c.missing).toEqual([]);
    expect(c.servingG).toBe(110);
    // (97 + 88.4) / 110 × 100
    expect(c.per100.energyKcal).toBeCloseTo(168.55, 2);
    expect(c.per100.fatG).toBeCloseTo(13.64, 2);
    // Olive oil has no fibre value, so fibre stays unknown instead of being undercounted.
    expect(c.per100.fiberG).toBeUndefined();
  });

  it("uses the cooked weight when cooking removes water, and refuses to guess missing ingredients", () => {
    const luqaimat = STANDARD_DISHES.find((d) => d.slug === "luqaimat")!;
    expect(composeDish(luqaimat, usda).missing.length).toBeGreaterThan(0);
    const all = new Map(luqaimat.ingredients.map((i) => [i.fdcId, { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1 }]));
    const c = composeDish(luqaimat, all);
    expect(c.servingG).toBe(80);
    expect(c.per100.energyKcal).toBeCloseTo((97 * 100) / 80, 1);
  });

  it("has unique slugs, Arabic names and positive weights", () => {
    expect(new Set(STANDARD_DISHES.map((d) => d.slug)).size).toBe(STANDARD_DISHES.length);
    for (const d of STANDARD_DISHES) {
      expect(d.nameAr).toMatch(/[؀-ۿ]/);
      expect(d.ingredients.every((i) => i.grams > 0 && /^\d+$/.test(i.fdcId))).toBe(true);
      expect(dietFlags({ name: d.name, ingredientsText: d.ingredients.map((i) => i.label).join(", ") })).toMatchObject({ pork: null, alcohol: null });
    }
  });
});

describe("pork and alcohol flags", () => {
  it("flags pork from names and ingredients, but not qualified look-alikes", () => {
    expect(dietFlags({ name: "Pepperoni pizza" }).pork).toBe("may_contain");
    expect(dietFlags({ name: "Club sandwich", ingredientsText: "bread, smoked bacon, lettuce" })).toMatchObject({ pork: "contains", reasons: { pork: ["ingredients: bacon"], alcohol: [] }, ingredientsChecked: true });
    expect(dietFlags({ name: "Turkey ham slices" }).pork).toBeNull();
    expect(dietFlags({ name: "Beef bacon" }).pork).toBeNull();
    expect(dietFlags({ name: "Bacon, turkey, unprepared" }).pork).toBeNull();
    expect(dietFlags({ name: "Bacon, meatless" }).pork).toBeNull();
    expect(dietFlags({ name: "Sausage, chicken, cooked" }).pork).toBeNull();
    expect(dietFlags({ name: "Canadian bacon, unprepared" }).pork).toBe("contains");
    expect(dietFlags({ name: "Pork, bacon, rendered fat, cooked" }).pork).toBe("contains");
    expect(dietFlags({ name: "Grilled hammour" }).pork).toBeNull();
    expect(dietFlags({ name: "Hamburger bun" }).pork).toBeNull();
    expect(dietFlags({ name: "Gummy bears", ingredientsText: "glucose syrup, sugar, gelatin" }).pork).toBe("may_contain");
    expect(dietFlags({ name: "Gummy bears", ingredientsText: "glucose syrup, sugar, beef gelatin" }).pork).toBeNull();
  });

  it("flags alcohol from ingredients and the alcohol nutrient, not vinegar or alcohol-free drinks", () => {
    expect(dietFlags({ name: "Tiramisu", ingredientsText: "mascarpone, coffee, marsala wine" }).alcohol).toBe("contains");
    expect(dietFlags({ name: "Balsamic dressing", ingredientsText: "olive oil, wine vinegar" }).alcohol).toBeNull();
    expect(dietFlags({ name: "Non-alcoholic beer" }).alcohol).toBeNull();
    expect(dietFlags({ name: "Ginger ale" }).alcohol).toBeNull();
    expect(dietFlags({ name: "Sugar-free candy", ingredientsText: "sugar alcohol (maltitol)" }).alcohol).toBeNull();
    expect(dietFlags({ name: "Lager", alcoholG: 3.9 }).alcohol).toBe("contains");
  });

  it("reports a manufacturer's halal label as their claim", () => {
    expect(dietFlags({ name: "Chicken franks", labelsTags: ["en:halal"] })).toMatchObject({ halalLabel: true, pork: null });
  });
});
