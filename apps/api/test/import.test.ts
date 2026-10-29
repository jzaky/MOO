import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => t.close());

async function user() {
  const u = await registerUser(t.app);
  await onboard(t.app, u.headers);
  return u;
}
const post = (u: { headers: Record<string, string> }, url: string, payload: unknown) => t.app.inject({ method: "POST", url, headers: u.headers, payload: payload as Record<string, unknown> });

const strong = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-09-01 07:00:00,Push,1h,"Bench Press (Barbell)",W,40,10,0,0,,,
2026-09-01 07:00:00,Push,1h,"Bench Press (Barbell)",1,80,8,0,0,,,
2026-09-01 07:00:00,Push,1h,"Bench Press (Barbell)",2,80,8,0,0,,,
2026-09-01 07:00:00,Push,1h,"Zercher Carry (Barbell)",1,60,20,0,0,,,
2026-09-08 07:00:00,Push,1h,"Bench Press (Barbell)",1,85,8,0,0,,,
2026-09-08 07:00:00,Push,1h,"Bench Press (Barbell)",2,85,7,0,0,,,
`;

describe("import: Strong", () => {
  it("previews without writing, matching known exercises and flagging unknown ones", async () => {
    const u = await user();
    const res = await post(u, "/v1/import/preview", { text: strong, weightUnit: "kg" });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ source: "strong", workouts: { count: 2, sets: 6, range: { from: "2026-09-01", to: "2026-09-08" } } });
    const bench = p.exercises.find((e: { name: string }) => e.name === "Bench Press (Barbell)");
    expect(bench.match.name).toMatch(/bench press/i);
    expect(p.exercises.find((e: { name: string }) => e.name.startsWith("Zercher")).match).toBeNull();
    expect((await t.app.inject({ method: "GET", url: "/v1/workouts", headers: u.headers })).json().items).toHaveLength(0);
  });

  it("imports oldest first so PRs are real, creates custom exercises, and is idempotent", async () => {
    const u = await user();
    const first = (await post(u, "/v1/import/commit", { text: strong, weightUnit: "kg" })).json();
    expect(first).toMatchObject({ workouts: { imported: 2, alreadyPresent: 0 }, sets: 6, exercisesCreated: ["Zercher Carry (Barbell)"] });
    const list = (await t.app.inject({ method: "GET", url: "/v1/workouts", headers: u.headers })).json().items as { day: string; summary: { personalRecords: { exerciseName: string }[] } }[];
    expect(list.map((w) => w.day)).toEqual(["2026-09-08", "2026-09-01"]);
    // The first session is a baseline; the heavier second one sets a bench PR.
    expect(list[1]!.summary.personalRecords).toEqual([]);
    expect(list[0]!.summary.personalRecords.some((p) => /bench/i.test(p.exerciseName))).toBe(true);

    const again = (await post(u, "/v1/import/commit", { text: strong, weightUnit: "kg" })).json();
    expect(again).toMatchObject({ workouts: { imported: 0, alreadyPresent: 2 }, exercisesCreated: [] });
    expect((await t.app.inject({ method: "GET", url: "/v1/workouts", headers: u.headers })).json().items).toHaveLength(2);
  });

  it("honours a skip choice and keeps users' imports apart", async () => {
    const a = await user(), b = await user();
    await post(a, "/v1/import/commit", { text: strong, weightUnit: "kg", exerciseChoices: { "Zercher Carry (Barbell)": "skip" } });
    const r = (await post(b, "/v1/import/commit", { text: strong, weightUnit: "kg" })).json();
    expect(r.workouts.imported).toBe(2);
    const w = (await t.app.inject({ method: "GET", url: "/v1/workouts?limit=5", headers: a.headers })).json().items;
    const s = (await t.app.inject({ method: "GET", url: `/v1/workouts/${w[1].id}`, headers: a.headers })).json();
    expect(s.exercises).toHaveLength(1);
  });
});

describe("import: MyFitnessPal", () => {
  const nutrition = `Date,Meal,Time,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note
2026-09-01,Breakfast,,420,12,,,,,,450,,55,6,12,24,,,,,
2026-09-01,Dinner,,700,25,,,,,,900,,60,,,50,,,,,
`;
  it("imports meal totals labelled as imported, keeps unknown values unknown, and re-imports nothing", async () => {
    const u = await user();
    const r = (await post(u, "/v1/import/commit", { text: nutrition })).json();
    expect(r).toMatchObject({ meals: { imported: 2 }, daysMarkedComplete: 0 });
    const day = (await t.app.inject({ method: "GET", url: "/v1/diary/2026-09-01", headers: u.headers })).json();
    expect(day.entries).toHaveLength(2);
    const dinner = day.entries.find((e: { meal: string }) => e.meal === "dinner");
    expect(dinner).toMatchObject({ provenance: "import", description: "Dinner (imported from MyFitnessPal)" });
    expect(dinner.nutrients.fiberG ?? null).toBeNull();
    expect(day.status).not.toBe("complete");
    expect((await post(u, "/v1/import/commit", { text: nutrition })).json().meals).toEqual({ imported: 0, alreadyPresent: 2 });
  });

  it("imports weigh-ins once", async () => {
    const u = await user();
    const csv = "Date,Weight (kg)\n2026-09-01,84.2\n2026-09-05,83.9\n";
    expect((await post(u, "/v1/import/commit", { text: csv })).json().weights).toEqual({ imported: 2, alreadyPresent: 0 });
    expect((await post(u, "/v1/import/commit", { text: csv })).json().weights).toEqual({ imported: 0, alreadyPresent: 2 });
  });

  it("explains unsupported files", async () => {
    const u = await user();
    const res = await post(u, "/v1/import/preview", { text: "foo,bar\n1,2\n" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Strong|Hevy|MyFitnessPal/);
  });
});
