import { addDays, readinessFromInsights, recoveryInsights, type DailySignals } from "@moo/core";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { dailyCheckins, healthObservations, setLogs, sessionExercises, workoutSessions } from "../db/schema";

/** Build per-day recovery signals (sleep, resting HR, training load, check-ins) for a window. */
export async function dailySignals(tx: Tx, userId: string, from: string, to: string): Promise<DailySignals[]> {
  const obs = await tx
    .select({ day: healthObservations.day, type: healthObservations.type, value: sql<number>`sum(${healthObservations.value})`, avg: sql<number>`avg(${healthObservations.value})` })
    .from(healthObservations)
    .where(and(eq(healthObservations.userId, userId), gte(healthObservations.day, from), lte(healthObservations.day, to), sql`${healthObservations.type} in ('sleep_minutes','resting_hr')`))
    .groupBy(healthObservations.day, healthObservations.type);
  // Training load proxy: hard sets × (RPE if logged, else 7).
  const load = await tx
    .select({ day: workoutSessions.day, load: sql<number>`sum(coalesce(${setLogs.rpe}, 7))` })
    .from(setLogs)
    .innerJoin(sessionExercises, eq(sessionExercises.id, setLogs.sessionExerciseId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
    .where(and(eq(setLogs.userId, userId), eq(setLogs.completed, true), sql`${setLogs.kind} <> 'warmup'`, gte(workoutSessions.day, from), lte(workoutSessions.day, to), sql`${workoutSessions.deletedAt} is null`))
    .groupBy(workoutSessions.day);
  const checkins = await tx.select().from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.day, from), lte(dailyCheckins.day, to)));

  const byDay = new Map<string, DailySignals>();
  const get = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day }));
    return d;
  };
  for (const o of obs) {
    if (o.type === "sleep_minutes") get(o.day).sleepMinutes = Number(o.value);
    if (o.type === "resting_hr") get(o.day).restingHr = Number(o.avg);
  }
  for (const l of load) get(l.day).trainingLoad = Number(l.load);
  for (const c of checkins) {
    const d = get(c.day);
    d.fatigue = c.fatigue;
    d.soreness = c.soreness;
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export async function recoverySnapshot(tx: Tx, userId: string, day: string) {
  const signals = await dailySignals(tx, userId, addDays(day, -34), day);
  const insights = recoveryInsights(signals, day);
  return { signals, insights, readiness: readinessFromInsights(insights) };
}
