import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapFdcFood, mapOffProduct, OpenFoodFactsClient, StaticFoodSources } from "../src/foods/sources";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

const laban = mapOffProduct({ product_name: "Fresh Laban", brands: ["Almarai", " المراعي"], countries_tags: ["en:united-arab-emirates"], nutriments: { "energy-kcal_100g": 50, proteins_100g: 3, carbohydrates_100g: 4.5, fat_100g: 2.5 } }, "6281007000000")!;

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ foodSources: new StaticFoodSources({}, [laban]) });
});
afterAll(async () => t.close());

describe("online food search", () => {
  it("reads brand lists from the search service", () => {
    expect(laban.brand).toBe("Almarai");
    expect(mapOffProduct({ product_name: "X", brands: "Nestlé, Nido", nutriments: {} }, "1")!.brand).toBe("Nestlé");
  });

  it("labels survey (FNDDS) portions from their description, not the numeric code", () => {
    const f = mapFdcFood({ fdcId: 9, description: "Falafel", dataType: "Survey (FNDDS)", foodNutrients: [{ nutrient: { number: "208" }, amount: 333 }], foodPortions: [{ gramWeight: 0, modifier: "90000", portionDescription: "Quantity not specified" }, { gramWeight: 17, modifier: "10205", portionDescription: '1 patty (2-1/4" dia)' }] })!;
    expect(f.servings.map((s) => s.label)).toEqual(['1 patty (2-1/4" dia)']);
  });

  it("returns online results separately and saves them to the catalogue", async () => {
    const u = await registerUser(t.app);
    await onboard(t.app, u.headers);
    const res = await t.app.inject({ method: "GET", url: "/v1/foods/search/online", headers: u.headers, query: { q: "laban" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.map((f: { name: string; brand: string }) => [f.name, f.brand])).toEqual([["Fresh Laban", "Almarai"]]);
    const local = (await t.app.inject({ method: "GET", url: "/v1/foods/search", headers: u.headers, query: { q: "laban", remote: "0" } })).json();
    expect(local.results.some((f: { name: string }) => f.name === "Fresh Laban")).toBe(true);
  });

  it("puts the user's country first and survives one of the two queries failing", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      const q = new URL(url).searchParams.get("q")!;
      calls.push(q);
      if (q.includes("countries_tags")) return new Response(JSON.stringify({ hits: [{ code: "1", product_name: "UAE milk", nutriments: { "energy-kcal_100g": 60 } }] }));
      return new Response("busy", { status: 503 });
    }) as typeof fetch;
    const client = new OpenFoodFactsClient("https://world.openfoodfacts.org", "test", fake);
    const r = await client.search("milk", "en:united-arab-emirates", 5);
    expect(r.map((f) => f.name)).toEqual(["UAE milk"]);
    expect(calls).toContain('milk countries_tags:"en:united-arab-emirates"');
  });
});
