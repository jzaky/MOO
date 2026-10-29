import { describe, expect, it } from "vitest";
import { caloriesProps, caloriesTimeline, nextLocalMidnight, nextWorkoutProps, snapshotFromToday } from "../src/features/native/widgetSnapshot";
import { parseWatchAction } from "../src/features/native/watchProtocol";
import type { TodayOverview } from "../src/lib/types";

const today = (over: Partial<TodayOverview> = {}): TodayOverview =>
  ({
    day: "2026-10-29",
    profile: { displayName: null, unitSystem: "metric" },
    nutrition: { totals: { energyKcal: 1450.4, proteinG: 92, carbsG: 0, fatG: 0 }, targets: { energyKcal: 2300, proteinG: 160 }, water: { totalMl: 0, targetMl: null }, entryCount: 3 },
    workout: { program: { id: "p", name: "PPL" }, scheduledToday: null, nextInRotation: { id: "t2", name: "Pull B" }, lastSession: null },
    ...over,
  }) as unknown as TodayOverview;

describe("widget snapshot", () => {
  it("computes kcal and protein left and the ring progress", () => {
    const s = snapshotFromToday(today(), null);
    expect(caloriesProps(s)).toEqual({ kcalLeft: 850, kcalTarget: 2300, proteinLeftG: 68, progress: 1450.4 / 2300, stale: false });
    expect(nextWorkoutProps(s)).toEqual({ name: "Pull B", label: "Next up", inProgress: false });
  });

  it("shows over-target as negative and clamps the ring", () => {
    const s = snapshotFromToday(today({ nutrition: { totals: { energyKcal: 2500, proteinG: 200, carbsG: 0, fatG: 0 }, targets: { energyKcal: 2300, proteinG: 160 } } as never }), null);
    expect(caloriesProps(s)).toMatchObject({ kcalLeft: -200, proteinLeftG: 0, progress: 1 });
  });

  it("handles a missing target and prefers the active, then the planned workout", () => {
    const s = snapshotFromToday(today({ nutrition: { totals: { energyKcal: 500, proteinG: 10, carbsG: 0, fatG: 0 }, targets: null } as never, workout: { program: { id: "p", name: "P" }, scheduledToday: { id: "t1", name: "Push A" }, nextInRotation: null, lastSession: null } }), null);
    expect(caloriesProps(s)).toMatchObject({ kcalLeft: null, proteinLeftG: null, progress: 0 });
    expect(nextWorkoutProps(s).label).toBe("Today");
    expect(nextWorkoutProps(snapshotFromToday(today(), "Lower A"))).toEqual({ name: "Lower A", label: "In progress", inProgress: true });
    expect(nextWorkoutProps(snapshotFromToday(today({ workout: null }), null))).toEqual({ name: null, label: "No plan yet", inProgress: false });
  });

  it("schedules a stale entry at the next local midnight", () => {
    const s = snapshotFromToday(today(), null);
    const now = new Date(2026, 9, 29, 21, 0).getTime();
    const tl = caloriesTimeline(s, now);
    expect(tl).toHaveLength(2);
    expect(tl[1]!.date.getTime()).toBe(new Date(2026, 9, 30).getTime());
    expect(tl[1]!.props.stale).toBe(true);
    expect(nextLocalMidnight("2026-12-31")).toBe(new Date(2027, 0, 1).getTime());
    // Data from a previous day is shown as stale right away.
    expect(caloriesTimeline(s, new Date(2026, 9, 30, 8).getTime()).map((e) => e.props.stale)).toEqual([true]);
  });
});

describe("watch protocol", () => {
  it("accepts only well-formed complete_set actions", () => {
    expect(parseWatchAction('{"type":"complete_set","exerciseRowId":"e1","setId":"s1"}')).toEqual({ type: "complete_set", exerciseRowId: "e1", setId: "s1" });
    expect(parseWatchAction({ type: "complete_set", exerciseRowId: "e1", setId: "s1", extra: 1 })).toEqual({ type: "complete_set", exerciseRowId: "e1", setId: "s1" });
    expect(parseWatchAction('{"type":"complete_set","exerciseRowId":"e1"}')).toBeNull();
    expect(parseWatchAction('{"type":"delete_all"}')).toBeNull();
    expect(parseWatchAction("not json")).toBeNull();
    expect(parseWatchAction(null)).toBeNull();
  });
});
