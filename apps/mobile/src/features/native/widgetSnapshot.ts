import type { TodayOverview } from "../../lib/types";
import type { CaloriesWidgetProps, NextWorkoutWidgetProps, WidgetSnapshot } from "./types";

/** Builds the widget snapshot from the Today overview (pure). */
export function snapshotFromToday(d: TodayOverview, activeWorkoutName: string | null): WidgetSnapshot {
  const n = d.nutrition;
  const t = n.targets;
  const planned = d.workout?.scheduledToday ?? null;
  const next = d.workout?.nextInRotation ?? null;
  return {
    day: d.day,
    kcalEaten: n.totals.energyKcal,
    kcalTarget: t ? t.energyKcal : null,
    proteinEatenG: n.totals.proteinG,
    proteinTargetG: t ? t.proteinG : null,
    workout: activeWorkoutName
      ? { name: activeWorkoutName, status: "in_progress" }
      : planned
        ? { name: planned.name, status: "today" }
        : next
          ? { name: next.name, status: "next" }
          : null,
  };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function caloriesProps(s: WidgetSnapshot, stale = false): CaloriesWidgetProps {
  const target = s.kcalTarget && s.kcalTarget > 0 ? Math.round(s.kcalTarget) : null;
  const proteinTarget = s.proteinTargetG && s.proteinTargetG > 0 ? s.proteinTargetG : null;
  if (stale) return { kcalLeft: null, kcalTarget: target, proteinLeftG: null, progress: 0, stale: true };
  return {
    kcalLeft: target == null ? null : Math.round(target - s.kcalEaten),
    kcalTarget: target,
    proteinLeftG: proteinTarget == null ? null : Math.max(0, Math.round(proteinTarget - s.proteinEatenG)),
    progress: target == null ? 0 : clamp01(s.kcalEaten / target),
    stale: false,
  };
}

export function nextWorkoutProps(s: WidgetSnapshot): NextWorkoutWidgetProps {
  const w = s.workout;
  if (!w) return { name: null, label: "No plan yet", inProgress: false };
  return { name: w.name, label: w.status === "in_progress" ? "In progress" : w.status === "today" ? "Today" : "Next up", inProgress: w.status === "in_progress" };
}

/** Start of the local day after `day` (YYYY-MM-DD), epoch ms. */
export function nextLocalMidnight(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  }
  return new Date(y, m - 1, d + 1).getTime();
}

/**
 * The calories timeline: today's numbers now, then a "stale" entry at the next
 * local midnight so the widget never shows yesterday's numbers as today's.
 */
export function caloriesTimeline(s: WidgetSnapshot, now = Date.now()): { date: Date; props: CaloriesWidgetProps }[] {
  const midnight = nextLocalMidnight(s.day);
  if (midnight <= now) return [{ date: new Date(now), props: caloriesProps(s, true) }];
  return [
    { date: new Date(now), props: caloriesProps(s) },
    { date: new Date(midnight), props: caloriesProps(s, true) },
  ];
}
