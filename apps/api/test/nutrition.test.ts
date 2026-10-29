import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAiProvider } from "../src/ai/fake";
import { upsertSharedFood } from "../src/foods/repository";
import { mapFdcFood, mapOffProduct, StaticFoodSources } from "../src/foods/sources";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const nutella = mapOffProduct(JSON.parse(readFileSync(path.join(here, "fixtures/off-3017620422003.json"), "utf8")).product, "3017620422003")!;
const chicken = mapFdcFood({ fdcId: 171477, description: "Chicken breast, roasted", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 165 }, { nutrientNumber: "203", value: 31 }, { nutrientNumber: "205", value: 0 }, { nutrientNumber: "204", value: 3.6 }], foodPortions: [{ gramWeight: 172, amount: 1, modifier: "breast" }] })!;
const rice = mapFdcFood({ fdcId: 169704, description: "Rice, white, cooked", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 130 }, { nutrientNumber: "203", value: 2.7 }, { nutrientNumber: "205", value: 28 }, { nutrientNumber: "204", value: 0.3 }], foodPortions: [{ gramWeight: 158, amount: 1, modifier: "cup" }] })!;
const egg = mapFdcFood({ fdcId: 171287, description: "Egg, whole, cooked, hard-boiled", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 155 }, { nutrientNumber: "203", value: 12.6 }, { nutrientNumber: "205", value: 1.1 }, { nutrientNumber: "204", value: 10.6 }], foodPortions: [{ gramWeight: 50, amount: 1, modifier: "large egg" }] })!;

let t: TestApp;
let ai: FakeAiProvider;
let ids: Record<string, string> = {};
const now = () => new Date().toISOString();

beforeAll(async () => {
  ai = new FakeAiProvider();
  t = await makeTestApp({ ai, foodSources: new StaticFoodSources({ "3017620422003": nutella }) });
  for (const [k, f] of Object.entries({ chicken, rice, egg })) ids[k] = await upsertSharedFood(t.db.system, f, new Date());
});
afterAll(async () => t.close());

async function user() {
  const u = await registerUser(t.app);
  await onboard(t.app, u.headers);
  return u;
}

describe("barcode lookup", () => {
  it("looks up, caches, and returns 404 with guidance for unknown products", async () => {
    const u = await user();
    const first = await t.app.inject({ method: "GET", url: "/v1/foods/barcode/3017620422003", headers: u.headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ origin: "source", food: { name: "Nutella", sourceLicense: expect.stringMatching(/ODbL/) } });
    const second = await t.app.inject({ method: "GET", url: "/v1/foods/barcode/3017620422003", headers: u.headers });
    expect(second.json().origin).toBe("cache");
    expect(second.json().food.id).toBe(first.json().food.id);
    const unknown = await t.app.inject({ method: "GET", url: "/v1/foods/barcode/4006381333931", headers: u.headers });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("barcode_not_found");
    const invalid = await t.app.inject({ method: "GET", url: "/v1/foods/barcode/4006381333932", headers: u.headers });
    expect(invalid.statusCode).toBe(400);
  });

  it("prefers the user's private product for the same barcode", async () => {
    const u = await user();
    const created = await t.app.inject({ method: "POST", url: "/v1/foods", headers: u.headers, payload: { name: "Local dates bar", barcode: "4006381333931", baseUnit: "g", per100: { energyKcal: 350, proteinG: 5, carbsG: 70, fatG: 5 }, servings: [{ label: "1 bar", baseAmount: 40 }], source: "label" } });
    expect(created.statusCode).toBe(201);
    const look = await t.app.inject({ method: "GET", url: "/v1/foods/barcode/4006381333931", headers: u.headers });
    expect(look.json()).toMatchObject({ origin: "private", food: { name: "Local dates bar", isPrivate: true } });
    // Another user cannot see it.
    const other = await user();
    const theirs = await t.app.inject({ method: "GET", url: `/v1/foods/${created.json().id}`, headers: other.headers });
    expect(theirs.statusCode).toBe(404);
  });
});

describe("search", () => {
  it("finds shared foods by fuzzy name and ranks the user's frequent foods first", async () => {
    const u = await user();
    const res = await t.app.inject({ method: "GET", url: "/v1/foods/search?q=chiken&remote=0", headers: u.headers });
    expect(res.json().results[0].name).toMatch(/Chicken/);
  });
});

describe("diary entries", () => {
  it("computes the nutrient snapshot server-side and is idempotent", async () => {
    const u = await user();
    const id = randomUUID();
    const servingId = (await t.app.inject({ method: "GET", url: `/v1/foods/${ids.chicken}`, headers: u.headers })).json().servings[0].id;
    const payload = { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "lunch", foodId: ids.chicken, portion: { kind: "serving", servingId, quantity: 1 }, nutrients: { energyKcal: 1 } };
    const r1 = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().entry.nutrients.energyKcal).toBeCloseTo(283.8); // 165 × 1.72 — client-sent value ignored
    expect(r1.json().entry.provenance).toBe("database");
    const r2 = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload });
    expect(r2.json().applied).toBe(false);
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json();
    expect(day.entries).toHaveLength(1);
    expect(day.meals.find((m: { meal: string }) => m.meal === "lunch").energyKcal).toBeCloseTo(283.8);
    expect(day.progress.find((p: { key: string }) => p.key === "proteinG").consumed).toBeCloseTo(53.32);
  });

  it("applies last-writer-wins and supports tombstone deletes", async () => {
    const u = await user();
    const id = randomUUID();
    const base = { day: "2026-10-28", loggedAt: now(), meal: "dinner", foodId: ids.rice, portion: { kind: "amount", quantity: 200, unit: "g" } };
    await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload: { ...base, clientUpdatedAt: "2026-10-28T10:00:00Z" } });
    const newer = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload: { ...base, portion: { kind: "amount", quantity: 300, unit: "g" }, clientUpdatedAt: "2026-10-28T10:05:00Z" } });
    expect(newer.json().entry.nutrients.energyKcal).toBeCloseTo(390);
    const stale = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload: { ...base, clientUpdatedAt: "2026-10-28T10:01:00Z" } });
    expect(stale.json()).toMatchObject({ applied: false, entry: { baseAmount: 300 } });
    const del = await t.app.inject({ method: "DELETE", url: `/v1/food-logs/${id}?clientUpdatedAt=2026-10-28T10:06:00Z`, headers: u.headers });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json().entries).toHaveLength(0);
  });

  it("keeps the estimate label on quick adds whose numbers came from AI", async () => {
    const u = await user();
    const id = randomUUID();
    const res = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "dinner", description: "Shawarma plate (menu estimate)", nutrients: { energyKcal: 780, proteinG: 42 }, provenance: "ai_estimate" } });
    expect(res.statusCode).toBe(200);
    const plain = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "dinner", description: "Snack", nutrients: { energyKcal: 120 } } });
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json();
    expect(day.entries.find((e: { id: string }) => e.id === id).provenance).toBe("ai_estimate");
    expect(day.entries.find((e: { id: string }) => e.id === plain.json().entry.id).provenance).toBe("user");
  });

  it("rejects quick adds without energy and portions without a density", async () => {
    const u = await user();
    const noEnergy = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "snacks", description: "Coffee", nutrients: { proteinG: 1 } } });
    expect(noEnergy.statusCode).toBe(400);
    const vol = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "snacks", foodId: ids.chicken, portion: { kind: "amount", quantity: 1, unit: "cup" } } });
    expect(vol.statusCode).toBe(400);
    expect(vol.json().error.message).toMatch(/density/);
  });

  it("keeps history unchanged when a food is later corrected", async () => {
    const u = await user();
    const id = randomUUID();
    await t.app.inject({ method: "PUT", url: `/v1/food-logs/${id}`, headers: u.headers, payload: { day: "2026-10-27", loggedAt: now(), clientUpdatedAt: now(), meal: "breakfast", foodId: ids.egg, portion: { kind: "amount", quantity: 100, unit: "g" } } });
    const corr = await t.app.inject({ method: "POST", url: `/v1/foods/${ids.egg}/corrections`, headers: u.headers, payload: { per100: { energyKcal: 143 }, reason: "different source" } });
    expect(corr.statusCode).toBe(201);
    expect(corr.json()).toMatchObject({ isPrivate: true, derivedFromFoodId: ids.egg, per100: { energyKcal: 143, proteinG: 12.6 } });
    const shared = (await t.app.inject({ method: "GET", url: `/v1/foods/${ids.egg}`, headers: u.headers })).json();
    expect(shared.per100.energyKcal).toBe(155);
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-27", headers: u.headers })).json();
    expect(day.entries[0].nutrients.energyKcal).toBe(155);
  });

  it("copies a meal idempotently and logs saved meals", async () => {
    const u = await user();
    for (const [food, g] of [[ids.chicken, 150], [ids.rice, 200]] as const) {
      await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-26", loggedAt: now(), clientUpdatedAt: now(), meal: "lunch", foodId: food, portion: { kind: "amount", quantity: g, unit: "g" } } });
    }
    const copy = { fromDay: "2026-10-26", fromMeal: "lunch", toDay: "2026-10-27", loggedAt: now() };
    expect((await t.app.inject({ method: "POST", url: "/v1/diary/copy", headers: u.headers, payload: copy })).json().created).toHaveLength(2);
    expect((await t.app.inject({ method: "POST", url: "/v1/diary/copy", headers: u.headers, payload: copy })).json().created).toHaveLength(0);

    const saved = await t.app.inject({ method: "POST", url: "/v1/saved-meals/from-diary", headers: u.headers, payload: { day: "2026-10-26", meal: "lunch", name: "Usual lunch" } });
    expect(saved.statusCode).toBe(201);
    const logReq = { day: "2026-10-28", meal: "lunch", loggedAt: "2026-10-28T12:00:00Z" };
    const l1 = await t.app.inject({ method: "POST", url: `/v1/saved-meals/${saved.json().id}/log`, headers: u.headers, payload: logReq });
    const l2 = await t.app.inject({ method: "POST", url: `/v1/saved-meals/${saved.json().id}/log`, headers: u.headers, payload: logReq });
    expect(l1.json().entries.map((e: { id: string }) => e.id)).toEqual(l2.json().entries.map((e: { id: string }) => e.id));
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json();
    expect(day.entries).toHaveLength(2);
    const list = (await t.app.inject({ method: "GET", url: "/v1/saved-meals", headers: u.headers })).json();
    expect(list.items[0]).toMatchObject({ name: "Usual lunch", useCount: 1 });
    expect(list.items[0].energyKcal).toBeCloseTo(247.5 + 260);
  });

  it("returns recent foods with the last portion for one-tap logging", async () => {
    const u = await user();
    await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "breakfast", foodId: ids.egg, portion: { kind: "amount", quantity: 150, unit: "g" } } });
    const recent = (await t.app.inject({ method: "GET", url: "/v1/foods/recent", headers: u.headers })).json();
    expect(recent.items[0]).toMatchObject({ food: { id: ids.egg }, lastPortion: { quantity: 150, unit: "g" }, lastMeal: "breakfast" });
  });

  it("tracks water and day completion", async () => {
    const u = await user();
    const id = randomUUID();
    await t.app.inject({ method: "PUT", url: `/v1/water-logs/${id}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), ml: 500, clientUpdatedAt: now() } });
    await t.app.inject({ method: "PUT", url: `/v1/water-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), ml: 250, clientUpdatedAt: now() } });
    await t.app.inject({ method: "PUT", url: "/v1/diary/2026-10-28/status", headers: u.headers, payload: { status: "complete" } });
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json();
    expect(day.water.totalMl).toBe(750);
    expect(day.water.targetMl).toBeGreaterThan(2000);
    expect(day.status).toBe("complete");
  });
});

describe("recipes", () => {
  it("computes per-serving nutrition, exposes the recipe as a loggable food, and drafts from text", async () => {
    const u = await user();
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: u.headers,
      payload: {
        name: "Chicken rice bowl",
        servings: 2,
        cookedYieldG: 700,
        ingredients: [
          { foodId: ids.chicken, rawText: "300 g chicken", portion: { kind: "amount", quantity: 300, unit: "g" } },
          { foodId: ids.rice, rawText: "400 g cooked rice", portion: { kind: "amount", quantity: 400, unit: "g" } },
          { foodId: null, rawText: "salt to taste", portion: null },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.perServing.energyKcal).toBeCloseTo((495 + 520) / 2);
    expect(r.missingIngredientCount).toBe(1);
    const log = await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: "2026-10-28", loggedAt: now(), clientUpdatedAt: now(), meal: "dinner", recipeId: r.id, portion: { kind: "serving", servingId: r.servingId, quantity: 1 } } });
    expect(log.json().entry).toMatchObject({ provenance: "recipe" });
    expect(log.json().entry.nutrients.energyKcal).toBeCloseTo(507.5);

    const draft = await t.app.inject({ method: "POST", url: "/v1/recipes/draft", headers: u.headers, payload: { text: "300 g chicken breast\n1 cup white rice\nsalt to taste" } });
    const d = draft.json();
    expect(d.ingredients[0].suggestion).toMatchObject({ foodId: ids.chicken, portion: { kind: "amount", quantity: 300, unit: "g" } });
    expect(d.ingredients[1].candidates[0].food.id).toBe(ids.rice);
  });
});

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
}

function multipart(files: Buffer[], fields: Record<string, string> = {}) {
  const boundary = "----stoke" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  files.forEach((f, i) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image${i}"; filename="p${i}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), f, Buffer.from("\r\n"));
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("photo recognition", () => {
  const analysis = {
    isFood: true,
    components: [
      { label: "Grilled chicken breast", searchQuery: "chicken breast", cookingMethod: "grilled", identityConfidence: 0.9, alternatives: ["turkey"], gramsEstimate: 150, gramsLow: 120, gramsHigh: 190, portionConfidence: 0.6, portionBasis: "palm-sized portion", hiddenIngredientRisk: "oil" },
      { label: "White rice", searchQuery: "rice white cooked", cookingMethod: null, identityConfidence: 0.85, alternatives: [], gramsEstimate: 200, gramsLow: 250, gramsHigh: 150, portionConfidence: 0.6, portionBasis: "about one cup", hiddenIngredientRisk: null },
      { label: "Brown sauce", searchQuery: "sauce", cookingMethod: null, identityConfidence: 0.3, alternatives: ["gravy", "teriyaki"], gramsEstimate: 30, gramsLow: 10, gramsHigh: 60, portionConfidence: 0.3, portionBasis: "drizzle", hiddenIngredientRisk: "sugar" },
    ],
    leftoverFraction: null,
    clarifyingQuestions: ["What was the sauce?"],
    notes: "",
  };

  it("requires consent, returns a draft with tiers and ranges, and logs only confirmed items", async () => {
    const u = await user();
    const img = multipart([await jpeg()]);
    const denied = await t.app.inject({ method: "POST", url: "/v1/ai/meal-photo", headers: { ...u.headers, ...img.headers }, payload: img.payload });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("consent_required");
    await t.app.inject({ method: "PUT", url: "/v1/profile/ai-consent", headers: u.headers, payload: { coachUsesHealthData: false, photoAnalysis: true, retainMealPhotos: false } });

    ai.queueStructured("food_photo", analysis);
    const img2 = multipart([await jpeg()]);
    const res = await t.app.inject({ method: "POST", url: "/v1/ai/meal-photo", headers: { ...u.headers, ...img2.headers }, payload: img2.payload });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.status).toBe("needs_clarification");
    expect(r.components.map((c: { tier: string }) => c.tier)).toEqual(["medium", "medium", "low"]);
    expect(r.components[1].grams).toEqual({ estimate: 200, low: 150, high: 250 }); // range re-ordered
    expect(r.components[0].suggested.foodId).toBe(ids.chicken);
    expect(r.components[2].needsUserInput).toBe(true);
    expect(r.totals.energyKcal).toBeCloseTo(247.5 + 260);
    expect(r.energyRangeKcal.low).toBeLessThan(r.energyRangeKcal.high);
    // The image sent to the model is a re-encoded JPEG (metadata stripped).
    const sent = ai.calls.at(-1)!.content as { type: string; mediaType?: string }[];
    expect(sent[0]).toMatchObject({ type: "image", mediaType: "image/jpeg" });

    const confirm = await t.app.inject({
      method: "POST",
      url: `/v1/ai/meal-photo/${r.recognitionId}/confirm`,
      headers: u.headers,
      payload: { day: "2026-10-28", meal: "dinner", loggedAt: now(), items: [{ id: randomUUID(), componentId: "c1", foodId: ids.chicken, portion: { kind: "amount", quantity: 170, unit: "g" } }] },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().entries[0]).toMatchObject({ provenance: "ai_estimate", recognitionId: r.recognitionId });
    expect(confirm.json().imagesDeleted).toBe(1);
  });

  it("rejects model output that fails schema validation", async () => {
    const u = await user();
    await t.app.inject({ method: "PUT", url: "/v1/profile/ai-consent", headers: u.headers, payload: { coachUsesHealthData: false, photoAnalysis: true, retainMealPhotos: false } });
    ai.queueStructured("food_photo", { isFood: true, components: [{ label: "x", identityConfidence: 7 }] });
    const img = multipart([await jpeg()]);
    const res = await t.app.inject({ method: "POST", url: "/v1/ai/meal-photo", headers: { ...u.headers, ...img.headers }, payload: img.payload });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("ai_output_invalid");
  });

  it("reads nutrition labels into a reviewable draft", async () => {
    const u = await user();
    await t.app.inject({ method: "PUT", url: "/v1/profile/ai-consent", headers: u.headers, payload: { coachUsesHealthData: false, photoAnalysis: true, retainMealPhotos: false } });
    ai.queueStructured("label_ocr", { isNutritionLabel: true, productName: "Laban", brand: "Al Rawabi", servingSizeText: "1 cup (240 ml)", servingSizeAmount: 240, servingSizeUnit: "ml", basis: "per_100", per100: { energyKcal: 52, energyKj: null, proteinG: 3, carbsG: 4.5, sugarG: 4.5, fatG: 2.5, saturatedFatG: 1.6, fiberG: null, sodiumMg: 50, saltG: null }, perServing: null, unreadableFields: [], languageNotes: "Arabic/English" });
    const img = multipart([await jpeg()], { barcode: "6291100000000" });
    const res = await t.app.inject({ method: "POST", url: "/v1/ai/nutrition-label", headers: { ...u.headers, ...img.headers }, payload: img.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().draft).toMatchObject({ name: "Laban", baseUnit: "ml", per100: { energyKcal: 52 }, servings: [{ baseAmount: 240 }] });
  });
});

describe("text logging", () => {
  it("parses deterministically and matches foods without writing anything", async () => {
    const u = await user();
    const res = (await t.app.inject({ method: "POST", url: "/v1/log/parse", headers: u.headers, payload: { text: "I ate 2 eggs and 200 grams of chicken breast for lunch" } })).json();
    expect(res).toMatchObject({ parser: "rules", kind: "food", meal: "lunch", requiresConfirmation: true });
    expect(res.items[0].suggestion).toMatchObject({ food: { id: ids.egg }, portion: { kind: "serving", quantity: 2 } });
    expect(res.items[1].suggestion).toMatchObject({ food: { id: ids.chicken }, portion: { kind: "amount", quantity: 200, unit: "g" } });
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-10-28", headers: u.headers })).json();
    expect(day.entries).toHaveLength(0);
  });

  it("falls back to the AI parser for free-form text and keeps unknown amounts unknown", async () => {
    const u = await user();
    ai.queueStructured("log_parse", { kind: "food", foods: [{ name: "shawarma wrap", quantity: null, unit: null, brandOrRestaurant: null }], meal: "dinner", exercises: [], bodyWeight: null, waterMl: null, ambiguities: ["Size of the wrap not stated"] });
    const res = (await t.app.inject({ method: "POST", url: "/v1/log/parse", headers: u.headers, payload: { text: "grabbed a shawarma on the way home" } })).json();
    expect(res).toMatchObject({ parser: "ai", kind: "food" });
    expect(res.items[0].parsed).toMatchObject({ name: "shawarma wrap", quantityAssumed: true });
    expect(res.issues).toContain("Size of the wrap not stated");
  });
});
