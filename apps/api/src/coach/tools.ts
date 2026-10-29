import { addDays, dayKeyInZone } from "@stoke/core";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Tx } from "../db/client";
import { coachRecommendations, exercises, goals, templateExercises, workoutSessions } from "../db/schema";
import type { AgentTool } from "../ai/provider";
import { getProfile, profileToDto, currentTargets } from "../routes/profile";
import { weightOverview } from "../routes/progress";
import { buildProgramProposal, exerciseHistory, loadProgram } from "../routes/training";
import { recoverySnapshot } from "../services/recovery";
import { mealSuggestions, nutritionSummary, proposeTargetsFromAdaptive, weeklyReview } from "../services/insights";
import { bestE1rm } from "@stoke/core";

/**
 * Coach tools. Read tools return the user's actual stored data; propose
 * tools create pending recommendations that the user must accept. No tool
 * writes to diaries, workouts, targets or goals directly.
 */

export interface ToolContext {
  tx: Tx;
  userId: string;
  now: Date;
  conversationId: string;
  healthDataAllowed: boolean;
}

export interface CoachSession {
  db: Database;
  userId: string;
  now: Date;
  conversationId: string;
  healthDataAllowed: boolean;
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(ctx: ToolContext, input: z.infer<S>): Promise<unknown>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d;

async function today(ctx: ToolContext) {
  const p = await getProfile(ctx.tx, ctx.userId);
  return dayKeyInZone(ctx.now, p.timeZone);
}

async function createRecommendation(ctx: ToolContext, kind: string, title: string, rationale: string, payload: unknown, evidence: unknown = {}) {
  const [r] = await ctx.tx
    .insert(coachRecommendations)
    .values({ userId: ctx.userId, conversationId: ctx.conversationId, kind, title, rationale, payload, evidence, source: "coach" })
    .returning({ id: coachRecommendations.id });
  return { recommendationId: r!.id, status: "proposed", note: "Shown to the user for approval. Nothing has been changed yet." };
}

const DayRange = z.object({ days: z.number().int().min(1).max(90).default(7) });

export const COACH_TOOLS = [
  def({
    name: "get_current_goals",
    description: "The user's active goals (in priority order), current nutrition targets and how they were set (estimated, adapted or manual), and profile preferences.",
    input: z.object({}),
    async run(ctx) {
      const p = profileToDto(await getProfile(ctx.tx, ctx.userId));
      const g = await ctx.tx.select().from(goals).where(and(eq(goals.userId, ctx.userId), eq(goals.status, "active"))).orderBy(asc(goals.priority));
      const t = await currentTargets(ctx.tx, ctx.userId, await today(ctx));
      return {
        goals: g.map((x) => ({ kind: x.kind, priority: x.priority, targetWeightKg: x.targetWeightKg, weeklyRatePct: x.weeklyRatePct, targetDate: x.targetDate })),
        targets: t ? { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fiberG: t.fiberG, basis: t.basis, since: t.effectiveFrom } : null,
        preferences: { unitSystem: p.unitSystem, dietary: p.dietary, training: p.training },
      };
    },
  }),
  def({
    name: "get_nutrition_summary",
    description: "Logged nutrition for the last N days: per-day totals, averages over complete days, protein-target adherence, and data-completeness notes.",
    input: DayRange,
    async run(ctx, i) {
      const end = await today(ctx);
      return nutritionSummary(ctx.tx, ctx.userId, addDays(end, -(i.days - 1)), end);
    },
  }),
  def({
    name: "get_meal_suggestions",
    description: "Meals or foods from the user's own history that fit what is left of today's targets, with exact database values.",
    input: z.object({}),
    async run(ctx) {
      return mealSuggestions(ctx.tx, ctx.userId, await today(ctx));
    },
  }),
  def({
    name: "get_workout_history",
    description: "Completed workouts in the last N days with session summaries (sets, reps, volume, PRs).",
    input: z.object({ days: z.number().int().min(1).max(180).default(28) }),
    async run(ctx, i) {
      const from = addDays(await today(ctx), -(i.days - 1));
      const rows = await ctx.tx.select().from(workoutSessions).where(and(eq(workoutSessions.userId, ctx.userId), eq(workoutSessions.status, "completed"), isNull(workoutSessions.deletedAt), gte(workoutSessions.day, from))).orderBy(desc(workoutSessions.startedAt)).limit(40);
      return { count: rows.length, sessions: rows.map((r) => ({ day: r.day, name: r.name, summary: r.summary ? { workSets: (r.summary as Record<string, unknown>).workSets, durationSec: (r.summary as Record<string, unknown>).durationSec, personalRecords: ((r.summary as Record<string, unknown>).personalRecords as unknown[] | undefined)?.length ?? 0 } : null })) };
    },
  }),
  def({
    name: "get_exercise_progress",
    description: "History and estimated-1RM trend for one exercise, looked up by name.",
    input: z.object({ exerciseName: z.string().min(1).max(80) }),
    async run(ctx, i) {
      const [ex] = await ctx.tx.select().from(exercises).where(sql`lower(${exercises.name}) % ${i.exerciseName.toLowerCase()} or ${i.exerciseName.toLowerCase()} = any(${exercises.aliases})`).orderBy(desc(sql`similarity(lower(${exercises.name}), ${i.exerciseName.toLowerCase()})`)).limit(1);
      if (!ex) return { found: false, message: `No exercise matching "${i.exerciseName}".` };
      const hist = await exerciseHistory(ctx.tx, ctx.userId, ex.id, { limit: 12 });
      return { found: true, exercise: ex.name, sessions: hist.map((h) => ({ day: h.day, sets: h.sets.filter((s) => s.kind !== "warmup").map((s) => `${s.weightKg}kg×${s.reps}`), bestE1rmKg: bestE1rm(h.sets) })) };
    },
  }),
  def({
    name: "get_weight_trend",
    description: "Weigh-ins, smoothed trend, rate of change with a data-sufficiency label, and goal progress.",
    input: z.object({}),
    async run(ctx) {
      const w = await weightOverview(ctx.tx, ctx.userId, await today(ctx));
      return { ...w, trend: w.trend.slice(-30) };
    },
  }),
  def({
    name: "get_recovery_summary",
    description: "Sleep, resting heart rate, training load and check-ins compared with the user's own baseline. Requires the user's consent to share health data with the coach.",
    input: z.object({}),
    async run(ctx) {
      if (!ctx.healthDataAllowed) return { available: false, message: "The user has not enabled sharing health data with the coach (Settings → Privacy)." };
      const s = await recoverySnapshot(ctx.tx, ctx.userId, await today(ctx));
      return { readiness: s.readiness, insights: s.insights, last14Days: s.signals.slice(-14) };
    },
  }),
  def({
    name: "get_weekly_review",
    description: "Last week's adherence, averages, training sessions, PRs, weight trend and whether the adaptive engine has enough data.",
    input: z.object({}),
    async run(ctx) {
      return weeklyReview(ctx.tx, ctx.userId, ctx.now);
    },
  }),
  def({
    name: "get_current_program",
    description: "The user's active training program with days, exercises and prescriptions.",
    input: z.object({}),
    async run(ctx) {
      const [row] = await ctx.tx.execute<{ id: string }>(sql`select id from workout_programs where user_id = ${ctx.userId} and status = 'active' order by created_at desc limit 1`);
      if (!row) return { found: false };
      const p = await loadProgram(ctx.tx, row.id);
      return { found: true, id: p.id, name: p.name, version: p.version, days: p.days.map((d) => ({ name: d.name, weekday: d.weekday, exercises: d.exercises.map((e) => ({ templateExerciseId: e.id, name: e.exercise.name, slug: e.exercise.slug, prescription: e.prescription })) })) };
    },
  }),
  def({
    name: "run_adaptive_target_check",
    description: "Run the deterministic adaptive-nutrition engine (logged intake vs weight trend). If it finds enough evidence for a change, it creates a pending target recommendation. Use this instead of inventing calorie changes.",
    input: z.object({}),
    async run(ctx) {
      const { result, recommendation } = await proposeTargetsFromAdaptive(ctx.tx, ctx.userId, await today(ctx));
      return { result, recommendationId: recommendation?.id ?? null };
    },
  }),
  def({
    name: "propose_workout_program",
    description: "Generate a training program with the deterministic generator (equipment, experience, preferences, time budget) and propose it for approval.",
    input: z.object({
      preferredDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
      sessionMinutes: z.number().int().min(20).max(180).optional(),
      goal: z.enum(["strength", "hypertrophy", "general"]).optional(),
      reason: z.string().max(400),
    }),
    async run(ctx, i) {
      const proposal = await buildProgramProposal(ctx.tx, ctx.userId, i);
      return { ...(await createRecommendation(ctx, "workout_program", `New program: ${proposal.draft.name}`, i.reason, proposal.draft, { rationale: proposal.rationale })), preview: proposal.preview.map((d) => ({ name: d.name, exercises: d.exercises.map((e) => e.name), estimatedMinutes: d.estimatedMinutes })) };
    },
  }),
  def({
    name: "propose_exercise_substitution",
    description: "Propose replacing one exercise in the active program (e.g. equipment unavailable, discomfort). Use template exercise ids from get_current_program and an exercise slug from the catalogue.",
    input: z.object({ templateExerciseId: z.string().uuid(), replacementSlug: z.string().max(80), reason: z.string().max(400) }),
    async run(ctx, i) {
      const [te] = await ctx.tx.select().from(templateExercises).where(eq(templateExercises.id, i.templateExerciseId));
      if (!te) return { ok: false, message: "Unknown template exercise id" };
      const [rep] = await ctx.tx.select().from(exercises).where(and(eq(exercises.slug, i.replacementSlug), isNull(exercises.ownerUserId)));
      if (!rep) return { ok: false, message: `Unknown exercise slug ${i.replacementSlug}` };
      const [orig] = await ctx.tx.select().from(exercises).where(eq(exercises.id, te.exerciseId));
      return createRecommendation(ctx, "exercise_substitution", `Swap ${orig?.name ?? "exercise"} for ${rep.name}`, i.reason, { templateExerciseId: te.id, fromExerciseId: te.exerciseId, toExerciseId: rep.id });
    },
  }),
  def({
    name: "propose_nutrition_targets",
    description: "Propose manual target changes the user asked for (e.g. more protein). For evidence-based calorie adjustments use run_adaptive_target_check instead. Targets below 1200 kcal (female) / 1500 kcal (male) are rejected.",
    input: z.object({ energyKcal: z.number().int().min(800).max(6000), proteinG: z.number().min(0).max(400), carbsG: z.number().min(0).max(900), fatG: z.number().min(0).max(300), reason: z.string().max(400) }),
    async run(ctx, i) {
      const p = await getProfile(ctx.tx, ctx.userId);
      const floor = p.sex === "male" ? 1500 : 1200;
      if (i.energyKcal < floor) return { ok: false, message: `Targets below ${floor} kcal are not proposed without clinical supervision.` };
      const macroKcal = i.proteinG * 4 + i.carbsG * 4 + i.fatG * 9;
      if (Math.abs(macroKcal - i.energyKcal) > 0.08 * i.energyKcal) return { ok: false, message: `Macros add up to ${Math.round(macroKcal)} kcal, which does not match ${i.energyKcal} kcal. Adjust and retry.` };
      return createRecommendation(ctx, "nutrition_targets", `Targets: ${i.energyKcal} kcal, ${i.proteinG} g protein`, i.reason, { energyKcal: i.energyKcal, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG, basis: "manual" });
    },
  }),
] as const;

export function toolSpecs(): AgentTool[] {
  return COACH_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

/** Each tool call runs in its own short RLS-scoped transaction (never held open across model calls). */
export async function runTool(session: CoachSession, name: string, rawInput: unknown): Promise<{ content: string; isError: boolean }> {
  const tool = COACH_TOOLS.find((t) => t.name === name);
  if (!tool) return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
  const parsed = (tool.input as z.ZodType).safeParse(rawInput ?? {});
  if (!parsed.success) return { content: JSON.stringify({ error: "Invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }), isError: true };
  try {
    const out = await session.db.asUser(session.userId, (tx) =>
      (tool.run as (c: ToolContext, i: unknown) => Promise<unknown>)({ tx, userId: session.userId, now: session.now, conversationId: session.conversationId, healthDataAllowed: session.healthDataAllowed }, parsed.data),
    );
    return { content: JSON.stringify(out), isError: false };
  } catch (e) {
    return { content: JSON.stringify({ error: (e as Error).message }), isError: true };
  }
}
