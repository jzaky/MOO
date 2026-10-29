import { CoachMessageRequest, ProgramCreate, RecommendationDecision } from "@stoke/contracts";
import { dayKeyInZone } from "@stoke/core";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runCoachTurn } from "../coach/coach";
import type { Tx } from "../db/client";
import { auditEvents, coachActions, coachConversations, coachMessages, coachRecommendations, goals, nutritionTargets, templateExercises, workoutPrograms, workoutTemplates } from "../db/schema";
import { badRequest, conflict, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { correlations, mealSuggestions, nutritionSummary, proposeTargetsFromAdaptive, todayOverview, weeklyReview } from "../services/insights";
import { currentTargets, getProfile, targetsToDto } from "./profile";
import { insertProgram, loadProgram } from "./training";

type Rec = typeof coachRecommendations.$inferSelect;

/** Apply an accepted recommendation. Every change is recorded in coach_actions with before/after. */
async function applyRecommendation(tx: Tx, userId: string, rec: Rec, now: Date) {
  const p = await getProfile(tx, userId);
  const today = dayKeyInZone(now, p.timeZone);
  switch (rec.kind) {
    case "nutrition_targets": {
      const payload = z.object({ energyKcal: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number(), fiberG: z.number().nullable().optional(), basis: z.enum(["adapted", "manual"]).default("adapted"), estimatedTdeeKcal: z.number().optional() }).parse(rec.payload);
      const before = await currentTargets(tx, userId, today);
      const [after] = await tx
        .insert(nutritionTargets)
        .values({ userId, effectiveFrom: today, energyKcal: Math.round(payload.energyKcal), proteinG: payload.proteinG, carbsG: payload.carbsG, fatG: payload.fatG, fiberG: payload.fiberG ?? before?.fiberG ?? null, waterMl: before?.waterMl ?? null, basis: payload.basis, estimatedTdeeKcal: payload.estimatedTdeeKcal ? Math.round(payload.estimatedTdeeKcal) : before?.estimatedTdeeKcal ?? null, recommendationId: rec.id, note: rec.title })
        .returning();
      await tx.insert(coachActions).values({ userId, recommendationId: rec.id, action: "nutrition_targets.updated", before: before ? targetsToDto(before) : null, after: targetsToDto(after!) });
      return { targets: targetsToDto(after!) };
    }
    case "workout_program": {
      const draft = ProgramCreate.parse(rec.payload);
      const active = await tx.select().from(workoutPrograms).where(and(eq(workoutPrograms.userId, userId), eq(workoutPrograms.status, "active")));
      await tx.update(workoutPrograms).set({ status: "archived", updatedAt: now }).where(and(eq(workoutPrograms.userId, userId), eq(workoutPrograms.status, "active")));
      const id = await insertProgram(tx, userId, draft, { createdBy: "ai", parentProgramId: active[0]?.id ?? null, version: (active[0]?.version ?? 0) + 1, changeReason: rec.rationale.slice(0, 300) });
      await tx.insert(coachActions).values({ userId, recommendationId: rec.id, action: "program.replaced", before: active.map((a) => ({ id: a.id, name: a.name })), after: { id } });
      return { programId: id };
    }
    case "exercise_substitution": {
      const payload = z.object({ templateExerciseId: z.uuid(), fromExerciseId: z.uuid(), toExerciseId: z.uuid() }).parse(rec.payload);
      const [te] = await tx.select().from(templateExercises).where(eq(templateExercises.id, payload.templateExerciseId));
      if (!te) throw badRequest("That program exercise no longer exists");
      const [tpl] = await tx.select({ programId: workoutTemplates.programId }).from(workoutTemplates).where(eq(workoutTemplates.id, te.templateId));
      if (!tpl?.programId) throw badRequest("That exercise is not part of a program");
      const program = await loadProgram(tx, tpl.programId);
      if (program.status !== "active") throw conflict("The program this applies to is no longer active");
      // New program version with the substitution; the old version is archived, not modified.
      const body = {
        name: program.name,
        split: program.split as z.infer<typeof ProgramCreate>["split"],
        notes: program.notes,
        days: program.days.map((d) => ({
          name: d.name,
          weekday: d.weekday,
          exercises: d.exercises.map((e) => ({ exerciseId: e.id === te.id ? payload.toExerciseId : e.exerciseId, supersetGroup: e.supersetGroup, prescription: e.prescription as z.infer<typeof ProgramCreate>["days"][number]["exercises"][number]["prescription"], notes: e.notes })),
        })),
      };
      await tx.update(workoutPrograms).set({ status: "archived", updatedAt: now }).where(eq(workoutPrograms.id, program.id));
      const id = await insertProgram(tx, userId, ProgramCreate.parse(body), { createdBy: "ai", parentProgramId: program.id, version: program.version + 1, changeReason: rec.title });
      await tx.insert(coachActions).values({ userId, recommendationId: rec.id, action: "program.exercise_substituted", before: { programId: program.id, exerciseId: payload.fromExerciseId }, after: { programId: id, exerciseId: payload.toExerciseId } });
      return { programId: id };
    }
    case "goal_update": {
      const payload = z.object({ goals: z.array(z.object({ kind: z.string(), priority: z.number().int(), targetWeightKg: z.number().nullable().optional(), weeklyRatePct: z.number().nullable().optional() })).min(1) }).parse(rec.payload);
      const before = await tx.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active")));
      await tx.update(goals).set({ status: "archived", endedAt: now }).where(and(eq(goals.userId, userId), eq(goals.status, "active")));
      const after = await tx.insert(goals).values(payload.goals.map((g) => ({ userId, kind: g.kind, priority: g.priority, targetWeightKg: g.targetWeightKg ?? null, weeklyRatePct: g.weeklyRatePct ?? null }))).returning();
      await tx.insert(coachActions).values({ userId, recommendationId: rec.id, action: "goals.updated", before, after });
      return { goals: after };
    }
    default:
      throw badRequest(`Recommendations of kind ${rec.kind} cannot be applied automatically`);
  }
}

export function registerCoachRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };
  const IdParam = z.object({ id: z.uuid() });

  app.get("/v1/today", auth, async (req) => ctx.db.asUser(req.userId, (tx) => todayOverview(tx, req.userId, ctx.now())));

  app.get("/v1/nutrition/suggestions", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      return mealSuggestions(tx, req.userId, dayKeyInZone(ctx.now(), p.timeZone));
    }),
  );

  app.get("/v1/nutrition/summary", auth, async (req) => {
    const q = parse(z.object({ from: z.iso.date(), to: z.iso.date() }), req.query);
    return ctx.db.asUser(req.userId, (tx) => nutritionSummary(tx, req.userId, q.from, q.to));
  });

  /** Run the adaptive engine; creates a pending recommendation only when evidence supports a change. */
  app.post("/v1/nutrition/adaptive-check", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const out = await proposeTargetsFromAdaptive(tx, req.userId, dayKeyInZone(ctx.now(), p.timeZone));
      return { result: out.result, recommendation: out.recommendation ? { id: out.recommendation.id, title: out.recommendation.title, payload: out.recommendation.payload } : null };
    }),
  );

  app.get("/v1/coach/weekly-review", auth, async (req) => ctx.db.asUser(req.userId, (tx) => weeklyReview(tx, req.userId, ctx.now())));
  app.get("/v1/insights/correlations", auth, async (req) => ctx.db.asUser(req.userId, (tx) => correlations(tx, req.userId, ctx.now())));

  app.post("/v1/coach/conversations", auth, async (req, reply) => {
    const row = await ctx.db.asUser(req.userId, async (tx) => (await tx.insert(coachConversations).values({ userId: req.userId }).returning())[0]!);
    return reply.status(201).send({ id: row.id, createdAt: row.createdAt.toISOString() });
  });

  app.get("/v1/coach/conversations", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => ({ items: (await tx.select().from(coachConversations).where(eq(coachConversations.userId, req.userId)).orderBy(desc(coachConversations.updatedAt)).limit(50)).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })) })),
  );

  app.get("/v1/coach/conversations/:id/messages", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(coachMessages).where(and(eq(coachMessages.conversationId, id), ne(coachMessages.role, "tool"))).orderBy(asc(coachMessages.createdAt));
      return { items: rows.filter((r) => r.text).map((r) => ({ id: r.id, role: r.role, text: r.text, createdAt: r.createdAt.toISOString() })) };
    });
  });

  app.post("/v1/coach/conversations/:id/messages", { ...auth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(CoachMessageRequest, req.body);
    return runCoachTurn(ctx, req.userId, id, body.text);
  });

  app.delete("/v1/coach/conversations/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.delete(coachConversations).where(eq(coachConversations.id, id)));
    return reply.status(204).send();
  });

  app.get("/v1/coach/recommendations", auth, async (req) => {
    const q = parse(z.object({ status: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional() }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(coachRecommendations).where(and(eq(coachRecommendations.userId, req.userId), q.status ? eq(coachRecommendations.status, q.status) : undefined)).orderBy(desc(coachRecommendations.createdAt)).limit(100);
      const actions = await tx.select().from(coachActions).where(eq(coachActions.userId, req.userId)).orderBy(desc(coachActions.createdAt)).limit(200);
      return { items: rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, title: r.title, rationale: r.rationale, payload: r.payload, evidence: r.evidence, source: r.source, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, actions: actions.filter((a) => a.recommendationId === r.id).map((a) => ({ action: a.action, before: a.before, after: a.after, createdAt: a.createdAt.toISOString() })) })) };
    });
  });

  /** The ONLY path by which coach/engine proposals change user data. */
  app.post("/v1/coach/recommendations/:id/decision", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(RecommendationDecision, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [rec] = await tx.select().from(coachRecommendations).where(eq(coachRecommendations.id, id)).for("update");
      if (!rec) throw notFound("Recommendation");
      if (rec.status !== "proposed") throw conflict(`This recommendation was already ${rec.status}`);
      let result: unknown = null;
      if (body.decision === "accept") result = await applyRecommendation(tx, req.userId, rec, ctx.now());
      await tx.update(coachRecommendations).set({ status: body.decision === "accept" ? "accepted" : "rejected", decidedAt: ctx.now(), decisionNote: body.note ?? null }).where(eq(coachRecommendations.id, id));
      await tx.insert(auditEvents).values({ userId: req.userId, event: `recommendation.${body.decision}ed`, targetType: "coach_recommendation", targetId: id, metadata: { kind: rec.kind } });
      return { id, status: body.decision === "accept" ? "accepted" : "rejected", result };
    });
  });
}
