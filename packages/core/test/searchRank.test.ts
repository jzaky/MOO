import { describe, expect, it } from "vitest";
import { rankFoods, sharesKeyWord, stem, wordMatches, type SearchCandidate } from "../src";

const c = (name: string, extra: Partial<SearchCandidate> = {}): SearchCandidate => ({ name, brand: null, isPrivate: false, uses: 0, completeness: 0.9, similarity: 0.5, ...extra });
const top = (q: string, names: (string | SearchCandidate)[]) => rankFoods(q, names.map((n) => (typeof n === "string" ? c(n) : n)))[0]!.name;

describe("food search ranking", () => {
  it("stems plurals without mangling words", () => {
    expect([stem("bananas"), stem("potatoes"), stem("berries"), stem("eggs"), stem("hummus"), stem("glass")]).toEqual(["banana", "potato", "berry", "egg", "hummus", "glass"]);
    expect(wordMatches("chiken", "chicken")).toBe(true);
    expect(wordMatches("chick", "chicken")).toBe(true);
    expect(wordMatches("rice", "price")).toBe(false);
  });

  it("prefers the food named in the head segment", () => {
    expect(top("banana raw", ["Pepper, banana, raw", "Bananas, raw", "Bananas, dehydrated, or banana powder"])).toBe("Bananas, raw");
    expect(top("greek yogurt", ["Milk, human, mature, fluid", "Yogurt, Greek, plain, nonfat", "Yogurt, Greek, fruit, whole milk"])).toBe("Yogurt, Greek, plain, nonfat");
  });

  it("sees through USDA category prefixes", () => {
    expect(top("oats", ["Oat bran, raw", "Oat flour, partially debranned", "Cereals, oats, regular and quick, not fortified, dry"])).toBe("Cereals, oats, regular and quick, not fortified, dry");
    expect(top("salmon", ["Salmon nuggets, breaded, frozen, heated", "Salmonberries, raw (Alaska Native)", "Fish, salmon, Atlantic, farmed, raw"])).toBe("Fish, salmon, Atlantic, farmed, raw");
    expect(top("almonds", ["Oil, almond", "Nuts, almonds", "Nuts, almond paste"])).toBe("Nuts, almonds");
  });

  it("keeps the % in queries like milk 2%", () => {
    expect(top("milk 2%", ["Yogurt, plain, skim milk", "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", "Milk, nonfat, fluid"])).toBe("Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D");
  });

  it("demotes processed forms the user did not ask for", () => {
    const chicken = ["Chicken breast tenders, breaded, cooked, microwaved", "Chicken breast, oven-roasted, fat-free, sliced", "Chicken, broilers or fryers, breast, meat only, cooked, roasted"];
    expect(top("chicken breast", chicken)).toBe("Chicken, broilers or fryers, breast, meat only, cooked, roasted");
    expect(top("chicken breast cooked", chicken)).toBe("Chicken, broilers or fryers, breast, meat only, cooked, roasted");
    expect(top("chicken nuggets", ["Chicken, broilers or fryers, breast, meat only, cooked, roasted", "Chicken nuggets, breaded, frozen"])).toBe("Chicken nuggets, breaded, frozen");
    expect(top("pork tenderloin", ["Pork, fresh, loin, tenderloin, separable lean only, cooked, roasted", "Pork, cured, ham, sliced"])).toMatch(/tenderloin/);
  });

  it("tolerates typos", () => {
    expect(top("chiken breast", ["Chickpeas, mature seeds, raw", "Chicken, broilers or fryers, breast, meat only, cooked, roasted"])).toMatch(/^Chicken, broilers/);
  });

  it("nudges the user's own and frequently logged foods up without overriding relevance", () => {
    expect(top("oats", [c("Cereals, oats, regular and quick, not fortified, dry"), c("My overnight oats", { isPrivate: true, uses: 12 })])).toBe("My overnight oats");
    expect(top("banana", [c("Bananas, raw"), c("Pepper, banana, raw", { uses: 1 })])).toBe("Bananas, raw");
  });
});

describe("food search ranking: refinements", () => {
  it("does not let descriptive words outweigh the food", () => {
    expect(top("oats raw", ["Oat bran, raw", "Cereals, oats, regular and quick, not fortified, dry"])).toMatch(/^Cereals, oats/);
  });
  it("prefers the everyday variety", () => {
    expect(top("milk", ["Milk, sheep, fluid", "Milk, whole, 3.25% milkfat, with added vitamin D", "Milk, human, mature, fluid"])).toMatch(/^Milk, whole/);
    expect(top("rice", ["Alcoholic beverage, rice (sake)", "Rice, white, long-grain, regular, enriched, cooked"])).toMatch(/^Rice, white/);
    expect(top("chiken", ["Chicken, meatless", "Chicken, ground, raw"])).toBe("Chicken, ground, raw");
  });
  it("ignores parenthetical notes when judging names", () => {
    expect(top("cheddar", ["Cheese, cheddar, nonfat or fat free", "Cheese, cheddar (Includes foods for USDA's Food Distribution Program)"])).toMatch(/USDA/);
  });
});

describe("food search ranking: head matching", () => {
  it("does not treat longer words as the requested food", () => {
    expect(top("milk", ["Fish, milkfish, raw", "Milk, buttermilk, fluid, whole", "Milk, whole, 3.25% milkfat, with added vitamin D"])).toMatch(/^Milk, whole/);
  });
  it("still completes a word being typed", () => {
    expect(top("chick", ["Chickpeas, mature seeds, raw", "Chicken, ground, raw", "Pepper, banana, raw"])).toMatch(/^Chick/);
    expect(top("banan", ["Pepper, banana, raw", "Bananas, raw"])).toBe("Bananas, raw");
  });
});

describe("suggestion guard", () => {
  it("accepts real word matches and rejects trigram look-alikes", () => {
    expect(sharesKeyWord("olive oil", "Oil, olive, salad or cooking")).toBe(true);
    expect(sharesKeyWord("chiken breast", "Chicken, broilers or fryers, breast")).toBe(true);
    expect(sharesKeyWord("za'atar", "Currants, zante, dried")).toBe(false);
    expect(sharesKeyWord("raw", "Bananas, raw")).toBe(true);
  });
});
