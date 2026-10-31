import type { FoodLog } from "../../lib/types";

const MEALS = ["breakfast", "lunch", "dinner", "snacks"] as const;

export type TimelineEvent =
  | { kind: "weigh"; key: string; at: null; kg: number }
  | { kind: "weigh_todo"; key: string; at: null }
  | { kind: "meal"; key: string; at: string; meal: string; items: string[]; kcal: number; pending: boolean }
  | { kind: "workout_done"; key: string; at: null; name: string }
  | { kind: "now"; key: string; at: string }
  | { kind: "workout_active"; key: string; at: string; name: string; setsDone: number }
  | { kind: "workout_next"; key: string; at: null; id: string; name: string; scheduled: boolean }
  | { kind: "meal_next"; key: string; at: null; meal: string; kcalLeft: number | null };

export interface TimelineInput {
  day: string;
  now: Date;
  entries: FoodLog[];
  weighedTodayKg: number | null;
  active: { name: string; startedAt: string; setsDone: number } | null;
  workout: { scheduledToday: { id: string; name: string } | null; nextInRotation: { id: string; name: string } | null; lastSession: { name: string; day: string } | null } | null;
  kcalLeft: number | null;
}

/**
 * Today as a timeline: what's done (weigh-in, meals grouped per meal at their first
 * log time, a finished workout), a "now" marker, then what's next (the workout in
 * progress or up next, and the next meal with the calories left).
 */
export function buildTimeline(i: TimelineInput): TimelineEvent[] {
  const done: TimelineEvent[] = [];
  if (i.weighedTodayKg != null) done.push({ kind: "weigh", key: "weigh", at: null, kg: i.weighedTodayKg });
  else if (i.now.getHours() < 12) done.push({ kind: "weigh_todo", key: "weigh-todo", at: null });

  const byMeal = new Map<string, FoodLog[]>();
  for (const e of i.entries) byMeal.set(e.meal, [...(byMeal.get(e.meal) ?? []), e]);
  const meals = [...byMeal.entries()].map(([meal, list]) => {
    const sorted = [...list].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    return {
      kind: "meal" as const,
      key: `meal-${meal}`,
      at: sorted[0]!.loggedAt,
      meal,
      items: sorted.map((e) => e.description),
      kcal: Math.round(sorted.reduce((a, e) => a + (e.nutrients.energyKcal ?? 0), 0)),
      pending: sorted.some((e) => e.pending),
    };
  });
  meals.sort((a, b) => a.at.localeCompare(b.at));
  done.push(...meals);
  if (i.workout?.lastSession?.day === i.day && !i.active) done.push({ kind: "workout_done", key: "workout-done", at: null, name: i.workout.lastSession.name });

  const next: TimelineEvent[] = [];
  if (i.active) next.push({ kind: "workout_active", key: "workout-active", at: i.active.startedAt, name: i.active.name, setsDone: i.active.setsDone });
  else if (i.workout?.lastSession?.day !== i.day) {
    const w = i.workout?.scheduledToday ?? i.workout?.nextInRotation;
    if (w) next.push({ kind: "workout_next", key: "workout-next", at: null, id: w.id, name: w.name, scheduled: !!i.workout?.scheduledToday });
  }
  // The next main meal not yet logged, from the one "now" falls in (same hours as the default meal).
  const h = i.now.getHours();
  const from = h < 11 ? 0 : h < 15 ? 1 : h < 22 ? 2 : 3;
  const upcoming = MEALS.slice(from, 3).find((m) => !byMeal.has(m));
  if (upcoming && (i.kcalLeft == null || i.kcalLeft > 0)) next.push({ kind: "meal_next", key: `next-${upcoming}`, at: null, meal: upcoming, kcalLeft: i.kcalLeft });

  return [...done, { kind: "now", key: "now", at: i.now.toISOString() }, ...next];
}
