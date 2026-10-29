import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLabelDraft } from "../src/routes/ai";
import { extractRecipeFromHtml } from "../src/foods/recipeImport";
import { isValidGtin, normalizeBarcode } from "../src/foods/normalize";
import { mapFdcFood, mapOffProduct } from "../src/foods/sources";
import { servingVolume, suggestPortion } from "../src/routes/recipes";
import { assertPublicUrl } from "../src/util/safeFetch";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => JSON.parse(readFileSync(path.join(here, "fixtures", name), "utf8"));

describe("Open Food Facts mapping (real API fixtures)", () => {
  it("maps Nutella per 100 g with sodium converted to mg", () => {
    const f = mapOffProduct(fixture("off-3017620422003.json").product, "3017620422003")!;
    expect(f.name).toBe("Nutella");
    expect(f.baseUnit).toBe("g");
    expect(f.per100.energyKcal).toBe(539);
    expect(f.per100.fatG).toBeCloseTo(30.9);
    expect(f.per100.sodiumMg).toBeCloseTo(42.8, 0);
    expect(f.sourceLicense).toMatch(/ODbL/);
    expect(f.quality.completeness).toBe(1);
    expect(f.quality.energyConsistent).toBe(true);
  });

  it("maps a beverage per 100 ml with its label serving", () => {
    const f = mapOffProduct(fixture("off-5449000000996.json").product, "5449000000996")!;
    expect(f.baseUnit).toBe("ml");
    expect(f.servings[0]).toMatchObject({ baseAmount: 330, source: "label" });
    expect(f.per100.energyKcal).toBeCloseTo(42.4);
  });

  it("never turns missing values into zeros and derives kcal from kJ with a flag", () => {
    const f = mapOffProduct({ product_name: "Mystery bar", nutriments: { "energy-kj_100g": 1674, proteins_100g: 10 } }, "123")!;
    expect(f.per100.energyKcal).toBeCloseTo(400, 0);
    expect(f.per100.fatG).toBeUndefined();
    expect(f.quality.flags).toEqual(expect.arrayContaining(["energy_from_kj", "missing_macros"]));
    expect(f.quality.completeness).toBe(0.5);
  });

  it("drops servings whose unit does not match the per-100 basis", () => {
    const f = mapOffProduct({ product_name: "Juice", product_quantity_unit: "g", serving_quantity: 250, serving_quantity_unit: "ml", nutriments: { "energy-kcal_100g": 45 } }, "1")!;
    expect(f.servings).toEqual([]);
    expect(f.quality.flags).toContain("serving_unit_mismatch");
  });

  it("rejects products without a name", () => {
    expect(mapOffProduct({ nutriments: {} }, "1")).toBeNull();
  });
});

describe("USDA FDC mapping", () => {
  it("maps nutrient numbers and portions", () => {
    const f = mapFdcFood({
      fdcId: 171477,
      description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
      dataType: "SR Legacy",
      foodNutrients: [
        { nutrientNumber: "208", value: 165 },
        { nutrientNumber: "203", value: 31.02 },
        { nutrientNumber: "205", value: 0 },
        { nutrientNumber: "204", value: 3.57 },
        { nutrientNumber: "307", value: 74 },
      ],
      foodPortions: [{ gramWeight: 172, amount: 1, modifier: "breast, bone and skin removed" }],
    })!;
    expect(f.per100).toMatchObject({ energyKcal: 165, proteinG: 31.02, carbsG: 0, fatG: 3.57, sodiumMg: 74 });
    expect(f.servings[0]).toMatchObject({ baseAmount: 172, source: "database" });
    expect(f.sourceLicense).toMatch(/CC0/);
  });

  it("uses Atwater energy for Foundation foods lacking 208", () => {
    const f = mapFdcFood({ fdcId: 1, description: "Oats", dataType: "Foundation", foodNutrients: [{ nutrientNumber: "957", value: 379 }, { nutrientNumber: "203", value: 13 }] })!;
    expect(f.per100.energyKcal).toBe(379);
    expect(f.quality.flags).toContain("energy_atwater");
  });
});

describe("barcodes", () => {
  it("validates check digits and normalizes UPC-A to EAN-13", () => {
    expect(isValidGtin("3017620422003")).toBe(true);
    expect(isValidGtin("3017620422004")).toBe(false);
    expect(normalizeBarcode("049000028911")).toBe("0049000028911");
    expect(normalizeBarcode("0049000028911")).toBe("0049000028911");
    expect(normalizeBarcode("96385074")).toBe("96385074");
    expect(normalizeBarcode("12345")).toBeNull();
  });
});

describe("recipe import", () => {
  it("extracts a schema.org Recipe from JSON-LD, including @graph", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        { "@type": ["Recipe"], name: "Chicken &amp; Rice", recipeYield: ["4 servings"], recipeIngredient: ["500 g chicken breast", "2 cups white rice"], recipeInstructions: [{ "@type": "HowToStep", text: "Cook." }] },
      ],
    })}</script></head></html>`;
    const r = extractRecipeFromHtml(html, "https://example.com/r")!;
    expect(r).toMatchObject({ name: "Chicken & Rice", servings: 4, ingredients: ["500 g chicken breast", "2 cups white rice"], instructions: ["Cook."] });
    expect(extractRecipeFromHtml("<html></html>", "x")).toBeNull();
  });

  it("refuses private network targets (SSRF)", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toThrow(/not allowed/);
    await expect(assertPublicUrl("http://10.0.0.5/")).rejects.toThrow(/not allowed/);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/not allowed/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://user:pw@example.com/")).rejects.toThrow(/credentials/);
  });
});

describe("label draft", () => {
  it("derives per-100 from per-serving and flags inconsistencies", () => {
    const d = buildLabelDraft(
      {
        isNutritionLabel: true,
        productName: "Protein Bar",
        brand: null,
        servingSizeText: "1 bar (60 g)",
        servingSizeAmount: 60,
        servingSizeUnit: "g",
        basis: "per_serving",
        per100: null,
        perServing: { energyKcal: 220, energyKj: null, proteinG: 20, carbsG: 22, sugarG: 3, fatG: 7, saturatedFatG: 3, fiberG: null, sodiumMg: null, saltG: 0.3 },
        unreadableFields: ["fiberG"],
        languageNotes: null,
      },
      null,
    );
    expect(d.draft.per100.energyKcal).toBeCloseTo(366.7, 0);
    expect(d.draft.per100.fiberG).toBeUndefined();
    expect(d.draft.per100.sodiumMg).toBeCloseTo(200, 0);
    expect(d.flags).toEqual(expect.arrayContaining(["per100_derived_from_serving", "sodium_from_salt"]));
    expect(d.needsReview).toBe(true);
  });
});

describe("ingredient amount suggestions", () => {
  const dto = (name: string, servings: [string, number][], extra: Record<string, unknown> = {}) =>
    ({ id: name, name, baseUnit: "g", densityGPerMl: null, per100: { energyKcal: 100 }, servings: servings.map(([label, baseAmount], i) => ({ id: `${name}-${i}`, label, baseAmount })), ...extra }) as unknown as Parameters<typeof suggestPortion>[1];
  const oil = dto("olive oil", [["1 tablespoon", 13.5], ["1 tsp", 4.5], ["1 cup", 216]]);
  const milk = dto("milk", [["1 fl oz", 30.5], ["1 cup", 244], ["1 quart", 976]]);
  const item = (quantity: number, unit: string) => ({ text: "", name: "x", quantity, unit, quantityAssumed: false }) as unknown as Parameters<typeof suggestPortion>[0];

  it("reads volume servings from USDA labels", () => {
    expect(servingVolume("1 tablespoon")).toEqual({ count: 1, unit: "tbsp" });
    expect(servingVolume("1 cup, chopped")).toEqual({ count: 1, unit: "cup" });
    expect(servingVolume("1/2 cup")).toEqual({ count: 0.5, unit: "cup" });
    expect(servingVolume("1 medium (2-1/2\" dia)")).toBeNull();
  });

  it("uses a serving in the same unit (tbsp = tablespoon)", () => {
    expect(suggestPortion(item(2, "tbsp"), oil)).toEqual({ kind: "serving", servingId: "olive oil-0", quantity: 2 });
  });

  it("derives grams from the food's own volume serving when no serving matches the unit", () => {
    // 200 ml × (244 g / 240 ml per cup)
    expect(suggestPortion(item(200, "ml"), milk)).toEqual({ kind: "amount", quantity: Math.round(200 * (244 / 240) * 10) / 10, unit: "g" });
  });

  it("counts whole items with a whole-item serving, never a slice", () => {
    const onion = dto("onion", [["1 slice, thin", 9], ["1 cup, chopped", 160], ["1 small", 70], ["1 medium (2-1/2\" dia)", 110], ["1 large", 150], ["10 rings", 60]]);
    const count = (n: number, unit = "") => ({ text: "", name: "onion", quantity: n, unit: { count: unit }, quantityAssumed: false }) as unknown as Parameters<typeof suggestPortion>[0];
    expect(suggestPortion(count(1), onion)).toEqual({ kind: "serving", servingId: "onion-3", quantity: 1 });
    expect(suggestPortion(count(2, "slice"), onion)).toEqual({ kind: "serving", servingId: "onion-0", quantity: 2 });
    // A unit the food has no serving for ("pinch") needs the user's amount.
    expect(suggestPortion(count(1, "pinch"), onion)).toBeNull();
    expect(suggestPortion(count(1), dto("flour", [["1 cup", 125]]))).toBeNull();
  });

  it("returns no amount rather than guessing when the food has no volume data", () => {
    expect(suggestPortion(item(1, "cup"), dto("chicken", [["1 breast", 172]]))).toBeNull();
    expect(suggestPortion(item(150, "g"), dto("chicken", []))).toEqual({ kind: "amount", quantity: 150, unit: "g" });
  });
});
