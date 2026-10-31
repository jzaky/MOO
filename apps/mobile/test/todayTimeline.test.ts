import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/features/today/timeline";
import type { FoodLog } from "../src/lib/types";

const log = (meal: string, at: string, kcal: number, description = "x"): FoodLog => ({ id: `${meal}-${at}`, day: "2026-10-31", loggedAt: at, meal, foodId: null, recipeId: null, description, portion: null, baseAmount: null, baseUnit: null, nutrients: { energyKcal: kcal }, provenance: "user", note: null, clientUpdatedAt: at });
const base = { day: "2026-10-31", entries: [] as FoodLog[], weighedTodayKg: null, active: null, workout: null, kcalLeft: 1200 };

describe("today timeline", () => {
  it("groups entries per meal at the first log time, sorted, with summed calories", () => {
    const ev = buildTimeline({ ...base, now: new Date("2026-10-31T16:05:00"), entries: [log("lunch", "2026-10-31T13:20:00Z", 500, "rice"), log("breakfast", "2026-10-31T08:10:00Z", 300, "eggs"), log("lunch", "2026-10-31T13:10:00Z", 231, "chicken")] });
    const meals = ev.filter((e) => e.kind === "meal");
    expect(meals.map((m) => [m.meal, m.kcal, m.items])).toEqual([
      ["breakfast", 300, ["eggs"]],
      ["lunch", 731, ["chicken", "rice"]],
    ]);
  });

  it("puts the next workout and the next unlogged meal after the now marker", () => {
    const ev = buildTimeline({ ...base, now: new Date("2026-10-31T16:05:00"), entries: [log("breakfast", "2026-10-31T08:00:00Z", 400)], workout: { scheduledToday: null, nextInRotation: { id: "t1", name: "Upper A" }, lastSession: null } });
    const kinds = ev.map((e) => e.kind);
    expect(kinds.indexOf("now")).toBeLessThan(kinds.indexOf("workout_next"));
    // Snack time: lunch is past, so the next slot offered is dinner.
    expect(ev.find((e) => e.kind === "meal_next")).toMatchObject({ meal: "dinner", kcalLeft: 1200 });
  });

  it("shows a finished workout as done and offers no next workout that day", () => {
    const ev = buildTimeline({ ...base, now: new Date("2026-10-31T19:00:00"), workout: { scheduledToday: { id: "t1", name: "Upper A" }, nextInRotation: null, lastSession: { name: "Upper A", day: "2026-10-31" } } });
    expect(ev.some((e) => e.kind === "workout_done")).toBe(true);
    expect(ev.some((e) => e.kind === "workout_next")).toBe(false);
  });

  it("asks for a weigh-in in the morning only, and no next meal once over target", () => {
    expect(buildTimeline({ ...base, now: new Date("2026-10-31T07:30:00") })[0]!.kind).toBe("weigh_todo");
    const late = buildTimeline({ ...base, now: new Date("2026-10-31T15:00:00"), kcalLeft: -50 });
    expect(late.some((e) => e.kind === "weigh_todo" || e.kind === "meal_next")).toBe(false);
  });
});
