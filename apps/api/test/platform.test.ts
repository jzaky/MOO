import { randomUUID } from "node:crypto";
import { LM } from "@stoke/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAiProvider } from "../src/ai/fake";
import { upsertSharedFood } from "../src/foods/repository";
import { mapFdcFood } from "../src/foods/sources";
import { assemblePlan } from "../src/routes/mealplans";
import { sendExpoPush } from "../src/routes/platform";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

let t: TestApp;
let ai: FakeAiProvider;
const f: Record<string, string> = {};

beforeAll(async () => {
  ai = new FakeAiProvider();
  t = await makeTestApp({ ai });
  const mk = (id: number, name: string, kcal: number, p: number, c: number, fat: number, category: string) =>
    upsertSharedFood(t.db.system, mapFdcFood({ fdcId: id, description: name, dataType: "SR Legacy", foodCategory: { description: category }, foodNutrients: [{ nutrientNumber: "208", value: kcal }, { nutrientNumber: "203", value: p }, { nutrientNumber: "205", value: c }, { nutrientNumber: "204", value: fat }] })!, new Date());
  f.chicken = await mk(910001, "Plan chicken breast", 165, 31, 0, 3.6, "Poultry Products");
  f.rice = await mk(910002, "Plan rice cooked", 130, 2.7, 28, 0.3, "Cereal Grains and Pasta");
  f.yogurt = await mk(910003, "Plan greek yogurt", 97, 9, 4, 5, "Dairy and Egg Products");
});
afterAll(async () => t.close());

async function user() {
  const u = await registerUser(t.app);
  await onboard(t.app, u.headers);
  return u;
}

describe("meal planning and groceries", () => {
  it("plans from the user's own recipes and saved meals, then builds a consolidated grocery list minus pantry", async () => {
    const u = await user();
    const noData = await t.app.inject({ method: "POST", url: "/v1/meal-plans/generate", headers: u.headers, payload: { startDay: "2026-11-02", days: 3 } });
    expect(noData.statusCode).toBe(400);
    await t.app.inject({ method: "POST", url: "/v1/recipes", headers: u.headers, payload: { name: "Chicken & rice", servings: 2, ingredients: [{ foodId: f.chicken, rawText: "400 g chicken", portion: { kind: "amount", quantity: 400, unit: "g" } }, { foodId: f.rice, rawText: "500 g rice", portion: { kind: "amount", quantity: 500, unit: "g" } }] } });
    await t.app.inject({ method: "POST", url: "/v1/saved-meals", headers: u.headers, payload: { name: "Yogurt bowl", defaultMeal: "breakfast", items: [{ foodId: f.yogurt, portion: { kind: "amount", quantity: 400, unit: "g" } }] } });
    const plan = await t.app.inject({ method: "POST", url: "/v1/meal-plans/generate", headers: u.headers, payload: { startDay: "2026-11-02", days: 3, meals: ["breakfast", "lunch", "dinner"] } });
    expect(plan.statusCode).toBe(201);
    const p = plan.json();
    // A saved meal tagged for breakfast is never scheduled at other meals.
    expect(p.items.filter((i: { name: string }) => i.name === "Yogurt bowl").every((i: { meal: string }) => i.meal === "breakfast")).toBe(true);
    expect(p.items).toHaveLength(9);
    expect(p.items.some((i: { name: string }) => i.name === "Chicken & rice")).toBe(true);
    expect(p.perDay[0].energyKcal).toBeGreaterThan(0);
    // A reloaded plan carries per-item nutrition, so day totals survive a refresh.
    const reloaded = (await t.app.inject({ method: "GET", url: `/v1/meal-plans/${p.id}`, headers: u.headers })).json();
    const day0 = reloaded.items.filter((i: { day: string }) => i.day === "2026-11-02");
    expect(day0.reduce((a: number, i: { energyKcal: number }) => a + i.energyKcal, 0)).toBe(p.perDay[0].energyKcal);

    await t.app.inject({ method: "PUT", url: "/v1/pantry", headers: u.headers, payload: { key: f.rice, name: "Rice", quantity: 300, unit: "g" } });
    const list = await t.app.inject({ method: "POST", url: `/v1/meal-plans/${p.id}/grocery-list`, headers: u.headers });
    expect(list.statusCode).toBe(201);
    const items = list.json().items as { key: string; quantity: number; unit: string; category: string }[];
    const chickenLine = items.find((i) => i.key === f.chicken)!;
    const recipeServings = p.items.filter((i: { name: string }) => i.name === "Chicken & rice").reduce((a: number, i: { servings: number }) => a + i.servings, 0);
    expect(chickenLine.quantity).toBe(Math.round((400 * recipeServings) / 2));
    expect(chickenLine.category).toBe("Poultry Products");
    const riceLine = items.find((i) => i.key === f.rice);
    const riceNeeded = (500 * recipeServings) / 2;
    if (riceNeeded > 300) expect(riceLine!.quantity).toBe(Math.round(riceNeeded - 300));
    const check = await t.app.inject({ method: "PATCH", url: `/v1/grocery-items/${(list.json().items[0] as { id: string }).id}`, headers: u.headers, payload: { checked: true } });
    expect(check.json().checked).toBe(true);
  });
});

describe("meal plan assembly", () => {
  const cand = (id: string, kcal: number, meals: string[] | null = null) => ({ kind: "recipe" as const, id, name: id, perUnit: { energyKcal: kcal, proteinG: kcal / 20 }, meals, scales: [0.5, 1, 1.5, 2] });
  it("does not serve the same dish at several meals of one day when alternatives exist", () => {
    const plan = assemblePlan([cand("bowl", 500), cand("soup", 330), cand("oats", 450)], 2300, 150, ["2026-11-02", "2026-11-03"], ["breakfast", "lunch", "dinner"]);
    for (const day of ["2026-11-02", "2026-11-03"]) {
      const ids = plan.filter((i) => i.day === day).map((i) => i.candidate.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("restaurant menus", () => {
  it("keeps printed values separate from labelled estimates", async () => {
    const u = await user();
    ai.queueStructured("menu", {
      restaurant: "Test Grill",
      items: [
        { name: "Grilled chicken plate", description: null, printedNutrition: { energyKcal: 520, proteinG: 48, carbsG: 40, fatG: 15 }, components: [] },
        { name: "Chicken & rice bowl", description: "with sauce", printedNutrition: null, components: [{ searchQuery: "plan chicken breast", gramsEstimate: 180, gramsLow: 140, gramsHigh: 220 }, { searchQuery: "plan rice cooked", gramsEstimate: 250, gramsLow: 200, gramsHigh: 320 }, { searchQuery: "mystery sauce", gramsEstimate: 40, gramsLow: 20, gramsHigh: 60 }] },
      ],
    });
    const r = (await t.app.inject({ method: "POST", url: "/v1/ai/menu", headers: u.headers, payload: { text: "Grilled chicken plate 520 kcal\nChicken & rice bowl" } })).json();
    const printed = r.dishes.find((d: { name: string }) => d.name === "Grilled chicken plate");
    const est = r.dishes.find((d: { name: string }) => d.name === "Chicken & rice bowl");
    expect(printed).toMatchObject({ basis: "printed", energyKcal: 520, energyRangeKcal: null });
    expect(est.basis).toBe("estimate");
    expect(est.energyRangeKcal.low).toBeLessThan(est.energyRangeKcal.high);
    expect(est.unmatchedComponents).toContain("mystery sauce");
    expect(r.disclaimer).toMatch(/approximations/);
  });
});

describe("platform", () => {
  it("exports only the user's own data", async () => {
    const a = await user();
    const b = await user();
    await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: a.headers, payload: { day: "2026-10-28", loggedAt: new Date().toISOString(), clientUpdatedAt: new Date().toISOString(), meal: "lunch", description: "Quick add", nutrients: { energyKcal: 500 } } });
    await t.app.inject({ method: "POST", url: "/v1/foods", headers: b.headers, payload: { name: "B's private food", baseUnit: "g", per100: { energyKcal: 100 } } });
    const res = await t.app.inject({ method: "GET", url: "/v1/me/export", headers: a.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const ex = res.json();
    expect(ex.account.email).toBe(a.email);
    expect(ex.data.foodLogs).toHaveLength(1);
    expect(ex.data.goals.length).toBeGreaterThan(0);
    expect(ex.data.privateFoods).toEqual([]);
    expect(JSON.stringify(ex)).not.toContain(b.email);
    expect(ex.data).not.toHaveProperty("users");
  });

  it("registers push tokens (moving them between accounts) and plans notifications in the user's time zone", async () => {
    const a = await user();
    const b = await user();
    const token = "ExponentPushToken[abc123def456]";
    expect((await t.app.inject({ method: "POST", url: "/v1/push-tokens", headers: a.headers, payload: { token, platform: "ios" } })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "POST", url: "/v1/push-tokens", headers: b.headers, payload: { token, platform: "ios" } })).statusCode).toBe(204);
    const plan = (await t.app.inject({ method: "GET", url: "/v1/notifications/plan", headers: a.headers })).json();
    expect(plan.items.some((i: { kind: string }) => i.kind === "weekly_summary" || i.kind === "workout" || i.kind === "check_in")).toBe(true);
    for (const i of plan.items) expect(new Date(i.sendAt).getTime()).toBeGreaterThan(Date.now());
    let sent: unknown = null;
    await sendExpoPush([token], { title: "t", body: "b" }, (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    expect(sent).toEqual([expect.objectContaining({ to: token, title: "t" })]);
  });

  it("analyses supported movements from landmarks only", async () => {
    const u = await user();
    const frame = (deg: number, tMs: number) => {
      const pts = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
      const r = (deg * Math.PI) / 180;
      for (const [hip, knee, ankle, x] of [[LM.leftHip, LM.leftKnee, LM.leftAnkle, 0.4], [LM.rightHip, LM.rightKnee, LM.rightAnkle, 0.6]] as const) {
        pts[knee] = { x, y: 0.6, visibility: 0.9 };
        pts[ankle] = { x, y: 0.8, visibility: 0.9 };
        pts[hip] = { x: x + 0.2 * Math.sin(r), y: 0.6 + 0.2 * Math.cos(r), visibility: 0.9 };
      }
      return { tMs, landmarks: pts };
    };
    const frames = [];
    let tt = 0;
    for (let rep = 0; rep < 3; rep++) for (let i = 0; i <= 60; i++) frames.push(frame(172 - 80 * Math.sin((Math.PI * i) / 60), (tt += 33)));
    const res = (await t.app.inject({ method: "POST", url: "/v1/movement/analyze", headers: u.headers, payload: { movement: "squat", frames } })).json();
    expect(res.repCount).toBe(3);
    const unsupported = await t.app.inject({ method: "POST", url: "/v1/movement/analyze", headers: u.headers, payload: { movement: "deadlift", frames } });
    expect(unsupported.statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("limits credential endpoints per IP", async () => {
    const t2 = await makeTestApp({ ai });
    // helpers raise limits; rebuild with a strict limit for this check
    await t2.close();
    const { buildApp } = await import("../src/app");
    const { loadConfig } = await import("../src/config");
    const { createDatabase } = await import("../src/db/client");
    const { TEST_APP_URL, TEST_OWNER_URL } = await import("./helpers");
    const db = createDatabase(TEST_APP_URL, TEST_OWNER_URL, { max: 2 });
    const { app } = await buildApp(loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_APP_URL, DATABASE_OWNER_URL: TEST_OWNER_URL, AUTH_RATE_LIMIT_PER_MIN: "3" } as NodeJS.ProcessEnv), { db, logger: false });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "x@example.com", password: "whatever-password" } })).statusCode);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    await app.close();
    await db.close();
  });
});

describe("notification delivery job", () => {
  it("sends due reminders once, even when run repeatedly", async () => {
    const { deliverDueNotifications } = await import("../src/jobs/sendNotifications");
    const u = await user();
    await t.app.inject({ method: "PUT", url: "/v1/notification-preferences", headers: u.headers, payload: { workoutReminders: false, mealReminders: false, hydrationReminders: false, weeklySummary: false, personalRecords: false, checkIns: true, quietStart: "23:00", quietEnd: "06:00" } });
    await t.app.inject({ method: "POST", url: "/v1/push-tokens", headers: u.headers, payload: { token: `ExponentPushToken[job${Date.now()}]`, platform: "android" } });
    // Check-ins go out at 08:30 Asia/Dubai = 04:30 UTC.
    const at = new Date("2026-11-03T04:35:00Z");
    const pushes: unknown[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      pushes.push(...JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await deliverDueNotifications(t.db, at, 10, fakeFetch);
    await deliverDueNotifications(t.db, at, 10, fakeFetch);
    const mine = pushes.filter((p) => (p as { to: string }).to.startsWith("ExponentPushToken[job"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "How are you feeling today?" });
  });
});
