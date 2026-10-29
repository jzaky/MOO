import { describe, expect, it } from "vitest";
import {
  buildGroceryList,
  clampClientTimestamp,
  confidenceTier,
  consumedFraction,
  dayKeyInZone,
  decideMerge,
  describeCorrelation,
  estimateMeal,
  isDayKey,
  mealFromUtterance,
  minutesOfDayInZone,
  parseLogUtterance,
  readinessFromInsights,
  recoveryInsights,
  startOfIsoWeek,
  addDays,
} from "../src";

describe("natural-language log parser", () => {
  it("parses multiple foods with counts and count units", () => {
    const r = parseLogUtterance("I ate three eggs and two slices of toast");
    expect(r.kind).toBe("food");
    if (r.kind !== "food") return;
    expect(r.items).toEqual([
      expect.objectContaining({ quantity: 3, unit: { count: "" }, name: "eggs", quantityAssumed: false }),
      expect.objectContaining({ quantity: 2, unit: { count: "slice" }, name: "toast" }),
    ]);
  });

  it("parses mass amounts", () => {
    const r = parseLogUtterance("Log 200 grams of chicken breast");
    expect(r).toMatchObject({ kind: "food", items: [{ quantity: 200, unit: "g", name: "chicken breast" }] });
    const r2 = parseLogUtterance("had 150g greek yogurt with a handful of blueberries");
    expect(r2).toMatchObject({ kind: "food", items: [{ quantity: 150, unit: "g", name: "greek yogurt" }, { quantity: 1, unit: { count: "handful" }, name: "blueberries" }] });
  });

  it("flags assumed quantities instead of hiding them", () => {
    const r = parseLogUtterance("I had oatmeal");
    expect(r.kind).toBe("food");
    expect(r.issues[0]).toMatch(/assumed 1 serving/);
  });

  it("parses sets of an exercise with load", () => {
    const r = parseLogUtterance("I did four sets of bench press at 80 kilos");
    expect(r).toMatchObject({ kind: "exercise", entries: [{ exerciseName: "bench press", sets: 4, weightKg: 80, reps: null }] });
    expect(r.issues.join(" ")).toMatch(/Reps not stated/);
  });

  it("parses NxM notation, reps, and pounds", () => {
    expect(parseLogUtterance("3x10 lat pulldown at 60kg")).toMatchObject({ kind: "exercise", entries: [{ exerciseName: "lat pulldown", sets: 3, reps: 10, weightKg: 60 }] });
    const r = parseLogUtterance("3 sets of squats at 225 lbs for 5 reps");
    expect(r).toMatchObject({ kind: "exercise", entries: [{ exerciseName: "squats", sets: 3, reps: 5, originalWeight: { value: 225, unit: "lb" } }] });
    if (r.kind === "exercise") expect(r.entries[0]!.weightKg).toBeCloseTo(102.06, 1);
  });

  it("parses body weight and water", () => {
    expect(parseLogUtterance("I weighed 82.4 kilos this morning")).toMatchObject({ kind: "body_weight", weightKg: 82.4 });
    expect(parseLogUtterance("weight 180 lbs")).toMatchObject({ kind: "body_weight", original: { value: 180, unit: "lb" } });
    expect(parseLogUtterance("drank 500 ml of water")).toMatchObject({ kind: "water", ml: 500 });
    expect(parseLogUtterance("drank 2 glasses of water")).toMatchObject({ kind: "water", ml: 500 });
  });

  it("rejects implausible values via issues and unrecognized input", () => {
    expect(parseLogUtterance("I weighed 8 kilos").issues.join(" ")).toMatch(/implausible/);
    expect(parseLogUtterance("what should I eat tonight?").kind).toBe("unrecognized");
    expect(mealFromUtterance("two eggs for breakfast")).toBe("breakfast");
  });
});

describe("photo recognition arithmetic", () => {
  it("tiers confidence and computes an energy range", () => {
    expect(confidenceTier(0.9)).toBe("high");
    expect(confidenceTier(0.6)).toBe("medium");
    expect(confidenceTier(0.2)).toBe("low");
    const m = estimateMeal([
      { id: "a", label: "grilled chicken", identityConfidence: 0.9, portionConfidence: 0.6, grams: { estimate: 150, low: 120, high: 190 }, matchedPer100: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 } },
      { id: "b", label: "white rice", identityConfidence: 0.85, portionConfidence: 0.6, grams: { estimate: 200, low: 150, high: 250 }, matchedPer100: { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 } },
      { id: "c", label: "sauce (unclear)", identityConfidence: 0.3, portionConfidence: 0.3, grams: { estimate: 30, low: 10, high: 60 }, matchedPer100: null },
    ]);
    expect(m.status).toBe("needs_clarification");
    expect(m.excludedComponentIds).toEqual(["c"]);
    expect(m.totals.energyKcal).toBeCloseTo(247.5 + 260);
    expect(m.energyRangeKcal).toEqual({ low: Math.round(198 + 195), high: Math.round(313.5 + 325) });
    expect(consumedFraction(0.25)).toBe(0.75);
    expect(consumedFraction(1.4)).toBe(0);
  });

  it("rejects inconsistent portion ranges", () => {
    expect(() => estimateMeal([{ id: "x", label: "x", identityConfidence: 1, portionConfidence: 1, grams: { estimate: 10, low: 20, high: 30 }, matchedPer100: {} }])).toThrow(RangeError);
  });
});

describe("grocery list", () => {
  it("consolidates compatible units and deducts pantry", () => {
    const list = buildGroceryList(
      [
        { key: "rice", name: "Rice", quantity: 300, unit: "g", category: "Grains", sourceRecipe: "Bowl" },
        { key: "rice", name: "Rice", quantity: 0.5, unit: "kg", category: "Grains", sourceRecipe: "Curry" },
        { key: "milk", name: "Milk", quantity: 1, unit: "cup", category: "Dairy" },
        { key: "egg", name: "Eggs", quantity: 6, unit: "egg", category: "Dairy" },
      ],
      [{ key: "rice", quantity: 200, unit: "g" }],
    );
    expect(list).toEqual([
      { key: "egg", name: "Eggs", quantity: 6, unit: "egg", category: "Dairy", sources: [] },
      { key: "milk", name: "Milk", quantity: 240, unit: "ml", category: "Dairy", sources: [] },
      { key: "rice", name: "Rice", quantity: 600, unit: "g", category: "Grains", sources: ["Bowl", "Curry"] },
    ]);
  });
});

describe("recovery insights", () => {
  it("compares recent sleep to the personal baseline, without a composite score", () => {
    const asOf = "2026-10-28";
    const signals = Array.from({ length: 31 }, (_, i) => {
      const day = addDays(asOf, -30 + i);
      return { day, sleepMinutes: i >= 28 ? 330 : 450, restingHr: 55, fatigue: i >= 28 ? 4 : 2 };
    });
    const ins = recoveryInsights(signals, asOf);
    expect(ins.map((i) => i.id)).toEqual(["sleep_below_baseline", "high_subjective_fatigue"]);
    expect(readinessFromInsights(ins)).toBe("poor");
    expect(readinessFromInsights([])).toBe("good");
  });
});

describe("statistics", () => {
  it("labels small samples as insufficient and always carries the causation caveat", () => {
    expect(describeCorrelation([1, 2, 3], [1, 2, 3]).strength).toBe("insufficient_data");
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const strong = describeCorrelation(xs, xs.map((x) => 2 * x + Math.sin(x)));
    expect(strong.strength).toBe("strong");
    expect(strong.pValue!).toBeLessThan(0.001);
    expect(strong.caveat).toMatch(/does not show/);
    const none = describeCorrelation(xs, xs.map((x) => (x * 13) % 31));
    expect(none.strength).toBe("none");
  });
});

describe("time and sync", () => {
  it("computes day keys in the user's zone", () => {
    const instant = new Date("2026-10-28T21:30:00Z");
    expect(dayKeyInZone(instant, "Asia/Dubai")).toBe("2026-10-29");
    expect(dayKeyInZone(instant, "America/New_York")).toBe("2026-10-28");
    expect(minutesOfDayInZone(instant, "Asia/Dubai")).toBe(90);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(startOfIsoWeek("2026-11-01")).toBe("2026-10-26");
  });

  it("merges with last-writer-wins and detects duplicates", () => {
    const a = { id: "1", clientUpdatedAt: "2026-10-28T10:00:00Z", reps: 8 };
    expect(decideMerge(a, null)).toBe("insert");
    expect(decideMerge(a, { ...a, version: 3 })).toBe("skip_duplicate");
    expect(decideMerge({ ...a, reps: 9, clientUpdatedAt: "2026-10-28T10:01:00Z" }, a)).toBe("apply");
    expect(decideMerge({ ...a, reps: 9, clientUpdatedAt: "2026-10-28T09:59:00Z" }, a)).toBe("skip_stale");
    expect(decideMerge({ ...a, deletedAt: "2026-10-28T10:00:00Z" }, a)).toBe("apply");
    const now = new Date("2026-10-28T10:00:00Z");
    expect(clampClientTimestamp("2027-01-01T00:00:00Z", now)).toBe(now.toISOString());
  });
});

import { parseIngredientLine } from "../src";
describe("ingredient lines", () => {
  it("parses quantities, fractions and preparation notes", () => {
    expect(parseIngredientLine("2 cups rolled oats")).toMatchObject({ quantity: 2, unit: "cup", name: "rolled oats" });
    expect(parseIngredientLine("½ tsp salt")).toMatchObject({ quantity: 0.5, unit: "tsp", name: "salt" });
    expect(parseIngredientLine("200g chicken thighs, diced")).toMatchObject({ quantity: 200, unit: "g", name: "chicken thighs", preparation: "diced" });
    expect(parseIngredientLine("1 1/2 cups milk (whole)")).toMatchObject({ quantity: 1.5, unit: "cup", name: "milk" });
    expect(parseIngredientLine("salt to taste")).toMatchObject({ quantity: 1, quantityAssumed: true });
  });
});
