import {
  addDays,
  dayKeyInZone,
  dayRange,
  describeCorrelation,
  estimateRate,
  isKnown,
  isoWeekday,
  mean,
  remainingInsight,
  runAdaptiveCheck,
  scalePer100,
  startOfIsoWeek,
  type IntakeDay,
  type NutrientValues,
  type Sex,
} from "@stoke/core";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { coachRecommendations, diaryDays, foodLogs, personalRecords, savedMeals, workoutPrograms, workoutSessions, workoutTemplates } from "../db/schema";
import { loadFoods } from "../foods/repository";
import { daySummary } from "../routes/diary";
import { currentTargets, getProfile, profileToDto } from "../routes/profile";
import { weightOverview, weightSeries } from "../routes/progress";
import { dailySignals, recoverySnapshot } from "./recovery";

export interface DayTotals {
  day: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  entries: number;
  meals: number;
  status: string | null;
}

export async function dailyTotals(tx: Tx, userId: string, from: string, to: string): Promise<DayTotals[]> {
  const rows = await tx
    .select({
      day: foodLogs.day,
      entries: sql<number>`count(*)::int`,
      meals: sql<number>`count(distinct ${foodLogs.meal})::int`,
      energyKcal: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'energyKcal')::float8), 0)`,
      proteinG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'proteinG')::float8), 0)`,
      carbsG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'carbsG')::float8), 0)`,
      fatG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'fatG')::float8), 0)`,
      fiberG: sql<number | null>`sum((${foodLogs.nutrients}->>'fiberG')::float8)`,
    })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), gte(foodLogs.day, from), lte(foodLogs.day, to), isNull(foodLogs.deletedAt)))
    .groupBy(foodLogs.day);
  const statuses = await tx.select().from(diaryDays).where(and(eq(diaryDays.userId, userId), gte(diaryDays.day, from), lte(diaryDays.day, to)));
  const st = new Map(statuses.map((s) => [s.day, s.status]));
  return rows.map((r) => ({ ...r, energyKcal: Number(r.energyKcal), proteinG: Number(r.proteinG), carbsG: Number(r.carbsG), fatG: Number(r.fatG), fiberG: r.fiberG == null ? null : Number(r.fiberG), status: st.get(r.day) ?? null })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Whether a day's log is complete enough for trend analysis. Explicit user
 * marks win; otherwise a heuristic: ≥ 2 meals and ≥ 60% of the energy target.
 */
export function isCompleteDay(d: DayTotals, targetKcal: number | null): boolean {
  if (d.status === "complete") return true;
  if (d.status === "incomplete") return false;
  return d.meals >= 2 && targetKcal != null && d.energyKcal >= 0.6 * targetKcal;
}

export async function nutritionSummary(tx: Tx, userId: string, from: string, to: string) {
  const days = await dailyTotals(tx, userId, from, to);
  const t = await currentTargets(tx, userId, to);
  const logged = days.filter((d) => d.entries > 0);
  const complete = logged.filter((d) => isCompleteDay(d, t?.energyKcal ?? null));
  const avg = (k: "energyKcal" | "proteinG" | "carbsG" | "fatG") => {
    const m = mean(complete.map((d) => d[k]));
    return m === null ? null : Math.round(m);
  };
  const fiberVals = complete.map((d) => d.fiberG).filter((v): v is number => v !== null);
  const proteinHit = t ? complete.filter((d) => d.proteinG >= t.proteinG * 0.9).length : null;
  return {
    from,
    to,
    daysInRange: dayRange(from, to).length,
    daysLogged: logged.length,
    completeDays: complete.length,
    averagesOverCompleteDays: { energyKcal: avg("energyKcal"), proteinG: avg("proteinG"), carbsG: avg("carbsG"), fatG: avg("fatG"), fiberG: fiberVals.length ? Math.round(mean(fiberVals)!) : null },
    targets: t ? { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fiberG: t.fiberG, basis: t.basis } : null,
    proteinTargetHitDays: proteinHit,
    days,
    notes: [
      "Averages use only days that look fully logged (or that you marked complete).",
      ...(fiberVals.length < complete.length ? ["Some foods lack fibre data, so fibre averages are lower bounds."] : []),
    ],
  };
}

export async function adaptiveCheck(tx: Tx, userId: string, asOf: string) {
  const p = await getProfile(tx, userId);
  const t = await currentTargets(tx, userId, asOf);
  if (!t) return { status: "insufficient_data" as const, reasons: ["No nutrition targets set yet."] };
  const start = addDays(asOf, -27);
  const days = await dailyTotals(tx, userId, start, asOf);
  const map = new Map(days.map((d) => [d.day, d]));
  const intake: IntakeDay[] = dayRange(start, asOf).map((day) => {
    const d = map.get(day);
    return { day, kcal: d ? d.energyKcal : null, complete: d ? isCompleteDay(d, t.energyKcal) : false };
  });
  const [goalRow] = await tx.execute<{ weekly_rate_pct: number | null; kind: string }>(sql`select weekly_rate_pct, kind from goals where user_id = ${userId} and status = 'active' order by priority limit 1`);
  const defaultRate: Record<string, number> = { lose_fat: -0.005, build_muscle: 0.0025, strength: 0.001 };
  const goalRate = goalRow?.weekly_rate_pct ?? defaultRate[goalRow?.kind ?? ""] ?? 0;
  const result = runAdaptiveCheck({
    asOf,
    intake,
    weighIns: await weightSeries(tx, userId),
    currentTargetKcal: t.energyKcal,
    priorTdeeKcal: t.estimatedTdeeKcal ?? t.energyKcal,
    goalWeeklyRatePct: goalRate,
    sex: (p.sex as Sex) ?? "female",
  });
  return { ...result, currentTargets: { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fiberG: t.fiberG } };
}

/** Create (or refresh) an engine recommendation for a proposed target change. */
export async function proposeTargetsFromAdaptive(tx: Tx, userId: string, asOf: string) {
  const r = await adaptiveCheck(tx, userId, asOf);
  if (r.status !== "adjust" || !("currentTargets" in r) || !r.currentTargets) return { result: r, recommendation: null };
  const cur = r.currentTargets;
  // Keep protein; move the energy change through carbs/fat proportionally to their current share.
  const delta = r.changeKcal;
  const cf = cur.carbsG * 4 + cur.fatG * 9;
  const carbsG = Math.max(50, Math.round((cur.carbsG + (cf ? (delta * (cur.carbsG * 4)) / cf / 4 : delta / 8)) / 5) * 5);
  const fatG = Math.max(30, Math.round((cur.fatG + (cf ? (delta * (cur.fatG * 9)) / cf / 9 : delta / 18)) / 5) * 5);
  await tx.update(coachRecommendations).set({ status: "superseded", decidedAt: new Date() }).where(and(eq(coachRecommendations.userId, userId), eq(coachRecommendations.kind, "nutrition_targets"), eq(coachRecommendations.status, "proposed"), eq(coachRecommendations.source, "engine")));
  const [rec] = await tx
    .insert(coachRecommendations)
    .values({
      userId,
      kind: "nutrition_targets",
      title: `${delta > 0 ? "Increase" : "Decrease"} daily energy by ${Math.abs(delta)} kcal`,
      rationale: r.reasons.join(" "),
      payload: { energyKcal: r.proposedTargetKcal, proteinG: cur.proteinG, carbsG, fatG, fiberG: cur.fiberG, basis: "adapted", estimatedTdeeKcal: r.blendedTdeeKcal },
      evidence: { observedTdeeKcal: r.observedTdeeKcal, blendedTdeeKcal: r.blendedTdeeKcal, completeDays: r.completeDays, observedKgPerWeek: r.observedKgPerWeek, goalKgPerWeek: r.goalKgPerWeek, confidence: r.confidence },
      source: "engine",
    })
    .returning();
  return { result: r, recommendation: rec! };
}

/**
 * Deterministic "what should I eat" suggestions from the user's own saved
 * meals and frequent foods, scored by fit to the remaining targets (protein
 * first). Values come from the database; the coach only phrases them.
 */
export async function mealSuggestions(tx: Tx, userId: string, day: string, limit = 3) {
  const summary = await daySummary(tx, userId, day);
  const remaining = Object.fromEntries(summary.progress.map((p) => [p.key, Math.round(p.remaining)])) as Record<string, number>;
  if (!summary.targets) return { remaining: null, suggestions: [], note: "Set nutrition targets to get suggestions." };
  const candidates: { kind: "saved_meal" | "food"; id: string; name: string; nutrients: NutrientValues; portionText: string; portion?: unknown }[] = [];
  const meals = await tx.select().from(savedMeals).where(and(eq(savedMeals.userId, userId), isNull(savedMeals.deletedAt))).limit(30);
  const foodIds = meals.flatMap((m) => (m.items as { foodId: string }[]).map((i) => i.foodId));
  const freq = await tx.execute<{ food_id: string; uses: number; portion: unknown }>(sql`
    select food_id, count(*)::int as uses, (array_agg(portion order by logged_at desc))[1] as portion
    from food_logs where user_id = ${userId} and deleted_at is null and food_id is not null
    group by food_id order by uses desc limit 25`);
  const foods = await loadFoods(tx, [...foodIds, ...freq.map((f) => f.food_id)]);
  for (const m of meals) {
    const parts = (m.items as { foodId: string; portion: { kind: string; quantity: number; servingId?: string; unit?: string } }[]).map((i) => {
      const f = foods.get(i.foodId);
      if (!f) return null;
      const base = i.portion.kind === "serving" ? (f.servings.find((s) => s.id === i.portion.servingId)?.baseAmount ?? 0) * i.portion.quantity : i.portion.quantity;
      return scalePer100(f.per100, base);
    });
    if (parts.some((p) => !p)) continue;
    const n: NutrientValues = {};
    for (const k of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) n[k] = parts.reduce((a, p) => a + (isKnown(p![k]) ? (p![k] as number) : 0), 0);
    candidates.push({ kind: "saved_meal", id: m.id, name: m.name, nutrients: n, portionText: "saved meal" });
  }
  for (const fr of freq) {
    const f = foods.get(fr.food_id);
    if (!f) continue;
    const portion = fr.portion as { kind: string; quantity: number; servingId?: string; unit?: string } | null;
    if (!portion) continue;
    const base = portion.kind === "serving" ? (f.servings.find((s) => s.id === portion.servingId)?.baseAmount ?? 0) * portion.quantity : portion.quantity;
    if (!base) continue;
    candidates.push({ kind: "food", id: f.id, name: f.name, nutrients: scalePer100(f.per100, base), portionText: portion.kind === "serving" ? `${portion.quantity} serving(s)` : `${portion.quantity} ${portion.unit}`, portion });
  }
  const remE = remaining.energyKcal ?? 0;
  const remP = remaining.proteinG ?? 0;
  const scored = candidates
    .filter((c) => isKnown(c.nutrients.energyKcal) && (c.nutrients.energyKcal as number) > 0)
    .map((c) => {
      const e = c.nutrients.energyKcal as number;
      const pr = isKnown(c.nutrients.proteinG) ? (c.nutrients.proteinG as number) : 0;
      const over = Math.max(0, e - Math.max(remE, 0));
      const score = (remP > 0 ? Math.min(pr, remP) / remP : 0) * 2 + (remE > 0 ? Math.min(e, remE) / remE : 0) - (over / Math.max(remE, 300)) * 2;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    remaining,
    suggestions: scored.map((s) => ({ kind: s.kind, id: s.id, name: s.name, portionText: s.portionText, portion: s.portion ?? null, energyKcal: Math.round(s.nutrients.energyKcal as number), proteinG: Math.round((s.nutrients.proteinG as number) ?? 0), fitScore: Math.round(s.score * 100) / 100 })),
    note: candidates.length ? "Suggestions come from your saved meals and foods you log often." : "Log a few meals or save favourites to get personalised suggestions.",
  };
}

export async function plannedWorkoutFor(tx: Tx, userId: string, day: string) {
  const programs = await tx.select().from(workoutPrograms).where(and(eq(workoutPrograms.userId, userId), eq(workoutPrograms.status, "active"))).orderBy(desc(workoutPrograms.createdAt)).limit(1);
  if (!programs[0]) return null;
  const templates = await tx.select().from(workoutTemplates).where(and(eq(workoutTemplates.programId, programs[0].id), isNull(workoutTemplates.deletedAt))).orderBy(asc(workoutTemplates.position));
  const wd = isoWeekday(day);
  const scheduled = templates.find((t) => t.weekday === wd) ?? null;
  // Next in rotation: the template after the most recently completed one.
  const [last] = await tx.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, "completed"), isNull(workoutSessions.deletedAt))).orderBy(desc(workoutSessions.startedAt)).limit(1);
  const lastIdx = last ? templates.findIndex((t) => t.id === last.templateId) : -1;
  const next = templates[(lastIdx + 1) % Math.max(1, templates.length)] ?? null;
  return { program: { id: programs[0].id, name: programs[0].name }, scheduledToday: scheduled ? { id: scheduled.id, name: scheduled.name } : null, nextInRotation: next ? { id: next.id, name: next.name } : null, lastSession: last ? { id: last.id, name: last.name, day: last.day } : null };
}

/** The Today screen in one request. Insight selection is rule-based and deterministic. */
export async function todayOverview(tx: Tx, userId: string, now: Date) {
  const p = await getProfile(tx, userId);
  const today = dayKeyInZone(now, p.timeZone);
  const [diary, recovery, weight, workout, recs] = [
    await daySummary(tx, userId, today),
    await recoverySnapshot(tx, userId, today),
    await weightOverview(tx, userId, today),
    await plannedWorkoutFor(tx, userId, today),
    await tx.select().from(coachRecommendations).where(and(eq(coachRecommendations.userId, userId), eq(coachRecommendations.status, "proposed"))).orderBy(desc(coachRecommendations.createdAt)).limit(5),
  ];
  const insights: { id: string; text: string; kind: "observed" | "calculated" | "suggestion" }[] = [];
  const protein = diary.progress.find((x) => x.key === "proteinG");
  if (protein && protein.remaining > 10) insights.push({ id: "protein_remaining", text: remainingInsight(protein, "g", "protein"), kind: "calculated" });
  for (const i of recovery.insights) insights.push({ id: i.id, text: i.message, kind: "observed" });
  if (weight.rate.sufficiency !== "insufficient" && weight.rate.kgPerWeek != null) {
    insights.push({ id: "weight_trend", text: `Trend weight is changing about ${weight.rate.kgPerWeek >= 0 ? "+" : ""}${weight.rate.kgPerWeek.toFixed(2)} kg per week${weight.rate.sufficiency === "limited" ? " (early estimate)" : ""}.`, kind: "calculated" });
  }
  if (recs.length) insights.push({ id: "pending_recommendation", text: `You have ${recs.length} suggestion${recs.length > 1 ? "s" : ""} to review.`, kind: "suggestion" });
  return {
    day: today,
    profile: { displayName: profileToDto(p).displayName, unitSystem: p.unitSystem },
    nutrition: { totals: { energyKcal: diary.totals.energyKcal.value, proteinG: diary.totals.proteinG.value, carbsG: diary.totals.carbsG.value, fatG: diary.totals.fatG.value }, progress: diary.progress, targets: diary.targets, water: diary.water, entryCount: diary.entries.length },
    workout,
    recovery: { readiness: recovery.readiness, insights: recovery.insights },
    weight: { latest: weight.latest, sevenDayAverageKg: weight.sevenDayAverageKg, rate: weight.rate },
    insights: insights.slice(0, 4),
    pendingRecommendations: recs.map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
  };
}

export async function weeklyReview(tx: Tx, userId: string, now: Date) {
  const p = await getProfile(tx, userId);
  const today = dayKeyInZone(now, p.timeZone);
  const weekStart = startOfIsoWeek(addDays(today, -7));
  const weekEnd = addDays(weekStart, 6);
  const nutrition = await nutritionSummary(tx, userId, weekStart, weekEnd);
  const sessions = await tx.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.status, "completed"), isNull(workoutSessions.deletedAt), gte(workoutSessions.day, weekStart), lte(workoutSessions.day, weekEnd)));
  const prs = await tx.select().from(personalRecords).where(and(eq(personalRecords.userId, userId), gte(personalRecords.day, weekStart), lte(personalRecords.day, weekEnd)));
  const planned = await plannedWorkoutFor(tx, userId, today);
  let plannedCount: number | null = null;
  if (planned) {
    const [row] = await tx.select({ c: sql<number>`count(*)::int` }).from(workoutTemplates).where(and(eq(workoutTemplates.programId, planned.program.id), isNull(workoutTemplates.deletedAt)));
    plannedCount = row?.c ?? null;
  }
  const weight = estimateRate(await weightSeries(tx, userId), weekEnd);
  const recovery = await recoverySnapshot(tx, userId, weekEnd);
  const adaptive = await adaptiveCheck(tx, userId, today);
  return {
    week: { start: weekStart, end: weekEnd },
    nutrition: { daysLogged: nutrition.daysLogged, completeDays: nutrition.completeDays, averages: nutrition.averagesOverCompleteDays, targets: nutrition.targets, proteinTargetHitDays: nutrition.proteinTargetHitDays },
    training: { sessionsCompleted: sessions.length, sessionsPlannedPerWeek: plannedCount, personalRecords: prs.length },
    weight: { kgPerWeek: weight.kgPerWeek, sufficiency: weight.sufficiency, latestTrendKg: weight.latestTrendKg },
    recovery: { readiness: recovery.readiness, insights: recovery.insights },
    adaptive: { status: adaptive.status, reasons: adaptive.reasons },
    labels: { observed: ["daysLogged", "sessionsCompleted", "personalRecords"], calculated: ["averages", "kgPerWeek"], estimates: ["adaptive"] },
  };
}

/** Exploratory correlations with explicit evidence labels. */
export async function correlations(tx: Tx, userId: string, now: Date) {
  const p = await getProfile(tx, userId);
  const today = dayKeyInZone(now, p.timeZone);
  const from = addDays(today, -90);
  const rec = await recoverySnapshot(tx, userId, today);
  const sig = await dailySignals(tx, userId, from, today);
  const sleepLoad = sig.filter((s) => s.sleepMinutes != null && s.trainingLoad != null);
  const days = await dailyTotals(tx, userId, from, today);
  const t = await currentTargets(tx, userId, today);
  const weights = new Map((await weightSeries(tx, userId, from, today)).map((w) => [w.day, w.kg]));
  const kcalNextWeight = days.filter((d) => isCompleteDay(d, t?.energyKcal ?? null) && weights.has(addDays(d.day, 1)) && weights.has(d.day));
  return {
    items: [
      { id: "sleep_vs_training_load", label: "Sleep (night before) vs training load", ...describeCorrelation(sleepLoad.map((s) => s.sleepMinutes!), sleepLoad.map((s) => s.trainingLoad!)) },
      { id: "intake_vs_next_day_weight_change", label: "Daily intake vs next-day scale change", ...describeCorrelation(kcalNextWeight.map((d) => d.energyKcal), kcalNextWeight.map((d) => weights.get(addDays(d.day, 1))! - weights.get(d.day)!)) },
    ],
    readiness: rec.readiness,
    note: "These are exploratory associations within your own data. Day-to-day scale changes are dominated by water and food volume.",
  };
}

