import { PrescriptionSchema, ProgramCreate, WorkoutUpsert, type PrescriptionDto } from "@stoke/contracts";
import {
  addDays,
  assessFatigue,
  bestE1rm,
  blockPosition,
  deloadRecommendation,
  isDeloadWeek,
  clampClientTimestamp,
  dayKeyInZone,
  DEFAULT_PROFILES,
  detectPersonalRecords,
  fitToTime,
  generateProgram,
  goalTrainingRationale,
  isWorkSet,
  recommendProgression,
  sessionsPerWeek,
  startOfIsoWeek,
  suggestSplit,
  summarizeWorkout,
  weeklySetsPerMuscle,
  type CatalogueExercise,
  type TrainingGoal,
  type LoggedSet,
  type Prescription,
  type ReadinessSignal,
  type SessionPerformance,
} from "@stoke/core";
import { TrainingPreferences } from "@stoke/contracts";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { auditEvents, exercises, goals, personalRecords, sessionExercises, setLogs, templateExercises, workoutPrograms, workoutSessions, workoutTemplates } from "../db/schema";
import { badRequest, conflict, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { recoverySnapshot } from "../services/recovery";
import { isUniqueViolation } from "../util/ids";
import { getProfile, trainingGoalFor } from "./profile";

type ExerciseRow = typeof exercises.$inferSelect;

export function exerciseToDto(e: ExerciseRow) {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    aliases: e.aliases,
    primaryMuscles: e.primaryMuscles,
    secondaryMuscles: e.secondaryMuscles,
    equipment: e.equipment,
    category: e.category,
    movementPattern: e.movementPattern,
    mechanics: e.mechanics,
    difficulty: e.difficulty,
    loadProfile: e.loadProfile,
    unilateral: e.unilateral,
    instructions: e.instructions,
    cautions: e.cautions,
    alternatives: e.alternatives,
    media: e.media,
    isCustom: e.ownerUserId !== null,
  };
}

export function toCorePrescription(p: PrescriptionDto | null | undefined, ex: { loadProfile: string }): Prescription {
  const rx = p ?? { scheme: "double_progression", sets: 3, repRange: { min: 8, max: 12 }, targetRir: 2, restSec: 120 };
  const key = (rx.loadProfile ?? ex.loadProfile) as keyof typeof DEFAULT_PROFILES;
  return {
    scheme: rx.scheme,
    sets: rx.sets,
    repRange: rx.repRange,
    targetRir: rx.targetRir ?? null,
    loadProfile: DEFAULT_PROFILES[key] ?? DEFAULT_PROFILES.machine,
    ...(rx.allowShortfall != null ? { allowShortfall: rx.allowShortfall } : {}),
    ...(rx.linearIncrementKg != null ? { linearIncrementKg: rx.linearIncrementKg } : {}),
  };
}

function rowToSet(s: typeof setLogs.$inferSelect): LoggedSet {
  return { weightKg: s.weightKg, reps: s.reps, kind: s.kind as LoggedSet["kind"], rir: s.rir, rpe: s.rpe, completed: s.completed, assistedReps: s.assistedReps };
}

/** Completed-session history for one exercise, oldest first. */
export async function exerciseHistory(tx: Tx, userId: string, exerciseId: string, opts: { beforeDay?: string; excludeSessionId?: string; limit?: number } = {}): Promise<(SessionPerformance & { sessionId: string })[]> {
  const rows = await tx
    .select({ sessionId: workoutSessions.id, day: workoutSessions.day, startedAt: workoutSessions.startedAt, set: setLogs })
    .from(setLogs)
    .innerJoin(sessionExercises, eq(sessionExercises.id, setLogs.sessionExerciseId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
    .where(
      and(
        eq(setLogs.userId, userId),
        eq(sessionExercises.exerciseId, exerciseId),
        eq(workoutSessions.status, "completed"),
        isNull(workoutSessions.deletedAt),
        opts.beforeDay ? lte(workoutSessions.day, opts.beforeDay) : undefined,
        opts.excludeSessionId ? sql`${workoutSessions.id} <> ${opts.excludeSessionId}` : undefined,
      ),
    )
    .orderBy(asc(workoutSessions.startedAt), asc(setLogs.position));
  const bySession = new Map<string, SessionPerformance & { sessionId: string }>();
  for (const r of rows) {
    const s = bySession.get(r.sessionId) ?? { sessionId: r.sessionId, day: r.day, sets: [] as LoggedSet[] };
    (s.sets as LoggedSet[]).push(rowToSet(r.set));
    bySession.set(r.sessionId, s);
  }
  const list = [...bySession.values()];
  return opts.limit ? list.slice(-opts.limit) : list;
}

async function loadSession(tx: Tx, id: string) {
  const [s] = await tx.select().from(workoutSessions).where(eq(workoutSessions.id, id));
  if (!s) return null;
  const exs = await tx.select({ se: sessionExercises, ex: exercises }).from(sessionExercises).innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId)).where(eq(sessionExercises.sessionId, id)).orderBy(asc(sessionExercises.position));
  const sets = exs.length ? await tx.select().from(setLogs).where(inArray(setLogs.sessionExerciseId, exs.map((e) => e.se.id))).orderBy(asc(setLogs.position)) : [];
  return {
    id: s.id,
    templateId: s.templateId,
    name: s.name,
    day: s.day,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    pausedSec: s.pausedSec,
    status: s.status,
    notes: s.notes,
    summary: s.summary,
    clientUpdatedAt: s.clientUpdatedAt.toISOString(),
    version: s.version,
    exercises: exs.map(({ se, ex }) => ({
      id: se.id,
      exerciseId: se.exerciseId,
      exercise: { id: ex.id, name: ex.name, slug: ex.slug, primaryMuscles: ex.primaryMuscles, equipment: ex.equipment, loadProfile: ex.loadProfile },
      position: se.position,
      supersetGroup: se.supersetGroup,
      prescription: se.prescription,
      notes: se.notes,
      sets: sets.filter((x) => x.sessionExerciseId === se.id).map((x) => ({ id: x.id, position: x.position, kind: x.kind, weightKg: x.weightKg, reps: x.reps, rir: x.rir, rpe: x.rpe, assistedReps: x.assistedReps, completed: x.completed, completedAt: x.completedAt?.toISOString() ?? null, targetWeightKg: x.targetWeightKg, targetReps: x.targetReps, originalUnit: x.originalUnit, notes: x.notes })),
    })),
  };
}

async function readinessFor(tx: Tx, userId: string, day: string): Promise<ReadinessSignal> {
  return (await recoverySnapshot(tx, userId, day)).readiness;
}

/** Summary, PRs and next-session targets for a completed workout. */
async function completeWorkout(tx: Tx, userId: string, sessionId: string, day: string) {
  const session = (await loadSession(tx, sessionId))!;
  const started = new Date(session.startedAt);
  const ended = session.endedAt ? new Date(session.endedAt) : new Date();
  const summary = summarizeWorkout(started, ended, session.exercises.map((e) => e.sets.map((s) => ({ ...s, kind: s.kind as LoggedSet["kind"] }))), session.pausedSec);
  await tx.delete(personalRecords).where(eq(personalRecords.sessionId, sessionId));
  const prs = [];
  const nextTargets = [];
  const readiness = await readinessFor(tx, userId, addDays(day, 1));
  for (const e of session.exercises) {
    const sets = e.sets.map((s) => ({ ...s, kind: s.kind as LoggedSet["kind"] }));
    if (!sets.some(isWorkSet)) continue;
    const prior = await exerciseHistory(tx, userId, e.exerciseId, { excludeSessionId: sessionId, beforeDay: day });
    const found = detectPersonalRecords(prior.map((p) => ({ exerciseId: e.exerciseId, day: p.day, sets: p.sets })), { exerciseId: e.exerciseId, day, sets });
    for (const pr of found) {
      await tx.insert(personalRecords).values({ userId, exerciseId: e.exerciseId, sessionId, kind: pr.kind, value: pr.value, weightKg: pr.weightKg, reps: pr.reps, previous: pr.previous, day });
      prs.push({ exerciseName: e.exercise.name, ...pr });
    }
    const rec = recommendProgression(toCorePrescription(e.prescription as PrescriptionDto | null, e.exercise), [...prior, { day, sets }], { today: addDays(day, 2), readiness });
    nextTargets.push({ exerciseId: e.exerciseId, exerciseName: e.exercise.name, ...rec });
    // Previous-session comparison: best e1RM now vs last time.
  }
  const comparison = [];
  for (const e of session.exercises) {
    const prior = await exerciseHistory(tx, userId, e.exerciseId, { excludeSessionId: sessionId, beforeDay: day, limit: 1 });
    const now = bestE1rm(e.sets.map((s) => ({ ...s, kind: s.kind as LoggedSet["kind"] })));
    const before = prior[0] ? bestE1rm(prior[0].sets) : null;
    comparison.push({ exerciseId: e.exerciseId, exerciseName: e.exercise.name, e1rmKg: now, previousE1rmKg: before, previousDay: prior[0]?.day ?? null });
  }
  const full = { ...summary, personalRecords: prs, nextTargets, comparison, readiness, note: "Volume (load × reps) is shown for reference; it is not a measure of session quality on its own." };
  await tx.update(workoutSessions).set({ summary: full }).where(eq(workoutSessions.id, sessionId));
  return full;
}

export async function loadProgram(tx: Tx, id: string) {
  const [p] = await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, id));
  if (!p) throw notFound("Program");
  const days = await tx.select().from(workoutTemplates).where(and(eq(workoutTemplates.programId, id), isNull(workoutTemplates.deletedAt))).orderBy(asc(workoutTemplates.position));
  const tes = days.length
    ? await tx.select({ te: templateExercises, ex: exercises }).from(templateExercises).innerJoin(exercises, eq(exercises.id, templateExercises.exerciseId)).where(inArray(templateExercises.templateId, days.map((d) => d.id))).orderBy(asc(templateExercises.position))
    : [];
  return {
    ...p,
    days: days.map((d) => ({
      id: d.id,
      name: d.name,
      weekday: d.weekday,
      position: d.position,
      exercises: tes.filter((t) => t.te.templateId === d.id).map((t) => ({ id: t.te.id, exerciseId: t.te.exerciseId, exercise: exerciseToDto(t.ex), position: t.te.position, supersetGroup: t.te.supersetGroup, prescription: t.te.prescription, notes: t.te.notes })),
    })),
  };
}

export async function insertProgram(tx: Tx, userId: string, body: z.infer<typeof ProgramCreate>, meta: { createdBy: string; parentProgramId?: string | null; version?: number; changeReason?: string | null }) {
  const exIds = body.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
  const visible = await tx.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, exIds));
  if (new Set(visible.map((v) => v.id)).size !== new Set(exIds).size) throw badRequest("One or more exercises do not exist");
  for (const d of body.days) for (const e of d.exercises) if (e.prescription.repRange.min > e.prescription.repRange.max) throw badRequest("Rep range minimum exceeds maximum");
  // Block settings carry over from the previous version unless the body sets them.
  const [parent] = meta.parentProgramId ? await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, meta.parentProgramId)) : [];
  const blockWeeks = body.blockWeeks !== undefined ? body.blockWeeks : (parent?.blockWeeks ?? null);
  const thisWeek = startOfIsoWeek(dayKeyInZone(new Date(), (await getProfile(tx, userId)).timeZone));
  const blockStart = blockWeeks ? (parent?.blockWeeks && parent.blockStart ? parent.blockStart : thisWeek) : null;
  const [p] = await tx
    .insert(workoutPrograms)
    .values({ userId, name: body.name, split: body.split, notes: body.notes ?? null, createdBy: meta.createdBy, parentProgramId: meta.parentProgramId ?? null, version: meta.version ?? 1, changeReason: meta.changeReason ?? null, blockWeeks, blockStart, deloadWeekStart: parent?.deloadWeekStart ?? null })
    .returning();
  for (const [i, d] of body.days.entries()) {
    const [t] = await tx.insert(workoutTemplates).values({ userId, programId: p!.id, name: d.name, weekday: d.weekday ?? null, position: i }).returning();
    await tx.insert(templateExercises).values(d.exercises.map((e, j) => ({ userId, templateId: t!.id, exerciseId: e.exerciseId, position: j, supersetGroup: e.supersetGroup ?? null, prescription: e.prescription, notes: e.notes ?? null })));
  }
  return p!.id;
}


const IdParam = z.object({ id: z.uuid() });

/**
 * Idempotent, last-writer-wins upsert of a workout session (used by the app's
 * sync and by imports). Completing a session computes its summary and PRs.
 */
export async function upsertWorkout(tx: Tx, userId: string, id: string, body: z.infer<typeof WorkoutUpsert>, now: Date) {
  const ts = new Date(clampClientTimestamp(body.clientUpdatedAt, now));
  const [existing] = await tx.select().from(workoutSessions).where(eq(workoutSessions.id, id));
  if (existing && existing.clientUpdatedAt.getTime() >= ts.getTime()) {
    return { session: await loadSession(tx, id), applied: false, summary: existing.summary };
  }
  const exIds = [...new Set(body.exercises.map((e) => e.exerciseId))];
  if (exIds.length) {
    const visible = await tx.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, exIds));
    if (visible.length !== exIds.length) throw badRequest("Unknown exercise in workout");
  }
  const values = { userId, templateId: body.templateId ?? null, name: body.name, day: body.day, startedAt: new Date(body.startedAt), endedAt: body.endedAt ? new Date(body.endedAt) : null, pausedSec: body.pausedSec, status: body.status, notes: body.notes ?? null, clientUpdatedAt: ts, updatedAt: now, deletedAt: body.status === "discarded" ? now : null };
  try {
    if (existing) await tx.update(workoutSessions).set({ ...values, version: existing.version + 1 }).where(eq(workoutSessions.id, id));
    else await tx.insert(workoutSessions).values({ id, ...values });
    await tx.delete(sessionExercises).where(eq(sessionExercises.sessionId, id));
    for (const e of body.exercises) {
      await tx.insert(sessionExercises).values({ id: e.id, userId: userId, sessionId: id, exerciseId: e.exerciseId, position: e.position, supersetGroup: e.supersetGroup ?? null, prescription: e.prescription ?? null, notes: e.notes ?? null });
      if (e.sets.length) {
        await tx.insert(setLogs).values(
          e.sets.map((s) => ({ id: s.id, userId: userId, sessionExerciseId: e.id, position: s.position, kind: s.kind, weightKg: s.weightKg, reps: s.reps, rir: s.rir ?? null, rpe: s.rpe ?? null, assistedReps: s.assistedReps ?? null, completed: s.completed, completedAt: s.completedAt ? new Date(s.completedAt) : null, targetWeightKg: s.targetWeightKg ?? null, targetReps: s.targetReps ?? null, originalUnit: s.originalUnit, notes: s.notes ?? null })),
        );
      }
    }
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An id in this workout is already in use");
    throw e;
  }
  let summary = existing?.summary ?? null;
  if (body.status === "completed") {
    summary = await completeWorkout(tx, userId, id, body.day);
    if (existing?.status !== "completed") await tx.insert(auditEvents).values({ userId: userId, event: "workout.completed", targetType: "workout_session", targetId: id });
  } else if (existing?.status === "completed") {
    await tx.delete(personalRecords).where(eq(personalRecords.sessionId, id));
    await tx.update(workoutSessions).set({ summary: null }).where(eq(workoutSessions.id, id));
    summary = null;
  }
  return { session: await loadSession(tx, id), applied: true, summary };
}

export function registerTrainingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  /* ── Exercises ── */

  app.get("/v1/exercises", auth, async (req) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), muscle: z.string().max(40).optional(), equipment: z.string().max(40).optional(), category: z.string().max(20).optional() }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const term = q.q?.toLowerCase();
      const rows = await tx
        .select()
        .from(exercises)
        .where(
          and(
            term ? or(sql`lower(${exercises.name}) like ${"%" + term.replace(/[%_]/g, "") + "%"}`, sql`lower(${exercises.name}) % ${term}`, sql`exists (select 1 from unnest(${exercises.aliases}) a where lower(a) like ${"%" + term.replace(/[%_]/g, "") + "%"})`) : undefined,
            q.muscle ? sql`${q.muscle} = any(${exercises.primaryMuscles})` : undefined,
            q.equipment ? eq(exercises.equipment, q.equipment) : undefined,
            q.category ? eq(exercises.category, q.category) : undefined,
          ),
        )
        .orderBy(term ? desc(sql`similarity(lower(${exercises.name}), ${term})`) : asc(exercises.name))
        .limit(200);
      return { items: rows.map(exerciseToDto) };
    });
  });

  app.get("/v1/exercises/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [e] = await tx.select().from(exercises).where(eq(exercises.id, id));
      if (!e) throw notFound("Exercise");
      const alts = e.alternatives.length ? await tx.select().from(exercises).where(and(inArray(exercises.slug, e.alternatives), isNull(exercises.ownerUserId))) : [];
      return { ...exerciseToDto(e), alternativeExercises: alts.map(exerciseToDto) };
    });
  });

  app.post("/v1/exercises", auth, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120),
        primaryMuscles: z.array(z.string().max(40)).min(1).max(6),
        secondaryMuscles: z.array(z.string().max(40)).max(8).default([]),
        equipment: z.string().max(40),
        movementPattern: z.string().max(40).default("isolation"),
        mechanics: z.enum(["compound", "isolation"]).default("isolation"),
        loadProfile: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight"]).default("machine"),
        category: z.enum(["strength", "cardio", "mobility"]).default("strength"),
        instructions: z.array(z.string().max(400)).max(10).default([]),
      }),
      req.body,
    );
    const row = await ctx.db.asUser(req.userId, async (tx) => {
      const [r] = await tx
        .insert(exercises)
        .values({ ...body, ownerUserId: req.userId, slug: `custom-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`, difficulty: "intermediate", license: "user" })
        .returning();
      return r!;
    });
    return reply.status(201).send(exerciseToDto(row));
  });

  app.get("/v1/exercises/:id/history", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const hist = await exerciseHistory(tx, req.userId, id, { limit: 50 });
      const prs = await tx.select().from(personalRecords).where(and(eq(personalRecords.userId, req.userId), eq(personalRecords.exerciseId, id))).orderBy(desc(personalRecords.day)).limit(20);
      return {
        sessions: hist.map((h) => ({ sessionId: h.sessionId, day: h.day, sets: h.sets, bestE1rmKg: bestE1rm(h.sets) })),
        personalRecords: prs,
        e1rmTrend: hist.map((h) => ({ day: h.day, e1rmKg: bestE1rm(h.sets) })).filter((p) => p.e1rmKg !== null),
      };
    });
  });

  app.get("/v1/exercises/:id/recommendation", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(z.object({ templateExerciseId: z.uuid().optional() }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [e] = await tx.select().from(exercises).where(eq(exercises.id, id));
      if (!e) throw notFound("Exercise");
      let rx: PrescriptionDto | null = null;
      if (q.templateExerciseId) {
        const [te] = await tx.select().from(templateExercises).where(eq(templateExercises.id, q.templateExerciseId));
        rx = (te?.prescription as PrescriptionDto) ?? null;
      }
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const readiness = await readinessFor(tx, req.userId, today);
      return recommendProgression(toCorePrescription(rx, e), await exerciseHistory(tx, req.userId, id), { today, readiness });
    });
  });

  /* ── Programs & templates ── */

  app.get("/v1/programs", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(workoutPrograms).where(and(eq(workoutPrograms.userId, req.userId), eq(workoutPrograms.status, "active"))).orderBy(desc(workoutPrograms.createdAt));
      const today = dayKeyInZone(ctx.now(), (await getProfile(tx, req.userId)).timeZone);
      const items = await Promise.all(rows.map((r) => loadProgram(tx, r.id)));
      // Where this week sits in the block, so clients don't need the profile's time zone.
      return {
        items: items.map((p) => {
          const block = blockPosition(p.blockStart, p.blockWeeks, today);
          return { ...p, block, deloadThisWeek: isDeloadWeek(today, block, p.deloadWeekStart) };
        }),
      };
    }),
  );

  app.get("/v1/programs/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, (tx) => loadProgram(tx, id));
  });

  app.get("/v1/programs/:id/versions", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const chain = [];
      let cur: string | null = id;
      while (cur && chain.length < 50) {
        const [p] = await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, cur));
        if (!p) break;
        chain.push({ id: p.id, version: p.version, status: p.status, createdBy: p.createdBy, changeReason: p.changeReason, createdAt: p.createdAt.toISOString() });
        cur = p.parentProgramId;
      }
      return { versions: chain };
    });
  });

  app.post("/v1/programs", auth, async (req, reply) => {
    const body = parse(ProgramCreate, req.body);
    const program = await ctx.db.asUser(req.userId, async (tx) => {
      const id = await insertProgram(tx, req.userId, body, { createdBy: "user" });
      await tx.insert(auditEvents).values({ userId: req.userId, event: "program.created", targetType: "workout_program", targetId: id });
      return loadProgram(tx, id);
    });
    return reply.status(201).send(program);
  });

  /** Editing creates a new version and archives the previous one (history is kept). */
  app.put("/v1/programs/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(ProgramCreate.extend({ changeReason: z.string().max(300).optional() }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [old] = await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, id));
      if (!old) throw notFound("Program");
      await tx.update(workoutPrograms).set({ status: "archived", updatedAt: ctx.now() }).where(eq(workoutPrograms.id, id));
      const newId = await insertProgram(tx, req.userId, body, { createdBy: "user", parentProgramId: id, version: old.version + 1, changeReason: body.changeReason ?? null });
      return loadProgram(tx, newId);
    });
  });

  app.delete("/v1/programs/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.update(workoutPrograms).set({ status: "archived" }).where(eq(workoutPrograms.id, id)));
    return reply.status(204).send();
  });

  /** Deterministic program proposal from the profile. Returned as a draft; POST /v1/programs to save it. */
  app.post("/v1/programs/generate", auth, async (req) => {
    const body = parse(
      z.object({
        preferredDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
        sessionMinutes: z.number().int().min(20).max(180).optional(),
        equipment: z.array(z.string().max(40)).max(20).optional(),
        goal: z.enum(["strength", "hypertrophy", "fat_loss", "recomposition", "endurance", "general"]).optional(),
      }),
      req.body ?? {},
    );
    return ctx.db.asUser(req.userId, async (tx) => buildProgramProposal(tx, req.userId, body));
  });

  /** Everything needed to start a workout from a template, including targets for today. */
  app.get("/v1/templates/:id/start", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(z.object({ minutes: z.coerce.number().int().min(10).max(240).optional() }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [t] = await tx.select().from(workoutTemplates).where(eq(workoutTemplates.id, id));
      if (!t) throw notFound("Workout template");
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const recovery = await recoverySnapshot(tx, req.userId, today);
      const [program] = t.programId ? await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, t.programId)) : [];
      const block = program ? blockPosition(program.blockStart, program.blockWeeks, today) : null;
      const deload = program ? isDeloadWeek(today, block, program.deloadWeekStart) : false;
      const tes = await tx.select({ te: templateExercises, ex: exercises }).from(templateExercises).innerJoin(exercises, eq(exercises.id, templateExercises.exerciseId)).where(eq(templateExercises.templateId, id)).orderBy(asc(templateExercises.position));
      type StartItem = {
        templateExerciseId: string;
        exercise: ReturnType<typeof exerciseToDto>;
        supersetGroup: number | null;
        prescription: PrescriptionDto;
        role: "main" | "secondary" | "accessory";
        previous: SessionPerformance | null;
        recommendation: ReturnType<typeof recommendProgression>;
        /** Best estimated 1RM on record (recorded e1RM PRs and recent sessions), for a live "new record" cue. */
        bestE1rmKg: number | null;
      };
      let items: StartItem[] = [];
      const prRows = tes.length
        ? await tx.select({ exerciseId: personalRecords.exerciseId, best: sql<number>`max(${personalRecords.value})` }).from(personalRecords).where(and(eq(personalRecords.kind, "e1rm"), inArray(personalRecords.exerciseId, tes.map((r) => r.ex.id)))).groupBy(personalRecords.exerciseId)
        : [];
      const prBest = new Map(prRows.map((r) => [r.exerciseId, Number(r.best)]));
      for (const { te, ex } of tes) {
        const history = await exerciseHistory(tx, req.userId, ex.id, { limit: 6 });
        let rx = te.prescription as PrescriptionDto;
        const core = toCorePrescription(rx, ex);
        let rec = recommendProgression(core, history, { today, readiness: recovery.readiness });
        if (deload) {
          const d = deloadRecommendation(rec, rx.sets, rx.targetRir, core.loadProfile);
          rec = d;
          rx = { ...rx, sets: d.targetSets, targetRir: d.targetRir };
        }
        items.push({
          templateExerciseId: te.id,
          exercise: exerciseToDto(ex),
          supersetGroup: te.supersetGroup,
          prescription: rx,
          role: ex.mechanics === "compound" ? (te.position === 0 ? "main" : "secondary") : "accessory",
          previous: history.at(-1) ?? null,
          recommendation: rec,
          bestE1rmKg: [prBest.get(ex.id) ?? null, ...history.map((h) => bestE1rm(h.sets))].reduce<number | null>((a, v) => (v != null && (a == null || v > a) ? v : a), null),
        });
      }
      let shortened = false;
      if (q.minutes) {
        const before = items.map((i) => `${i.templateExerciseId}:${i.prescription.sets}`).join();
        items = fitToTime(items.map((i) => ({ ...i, prescription: { ...i.prescription, restSec: i.prescription.restSec ?? 120 } })), q.minutes);
        shortened = items.map((i) => `${i.templateExerciseId}:${i.prescription.sets}`).join() !== before;
      }
      return { template: { id: t.id, name: t.name }, day: today, readiness: recovery.readiness, recoveryInsights: recovery.insights, shortened, block, deload, items };
    });
  });

  /* ── Blocks, deloads and fatigue ── */

  /** Change block length (3–8 weeks, last one a deload) or switch blocks off. Scheduling only: no new program version. */
  app.put("/v1/programs/:id/block", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(z.object({ blockWeeks: z.number().int().min(3).max(8).nullable(), restart: z.boolean().default(false) }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [prog] = await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, id));
      if (!prog) throw notFound("Program");
      const today = dayKeyInZone(ctx.now(), (await getProfile(tx, req.userId)).timeZone);
      const blockStart = body.blockWeeks ? (body.restart || !prog.blockStart ? startOfIsoWeek(today) : prog.blockStart) : null;
      await tx.update(workoutPrograms).set({ blockWeeks: body.blockWeeks, blockStart, updatedAt: ctx.now() }).where(eq(workoutPrograms.id, id));
      await tx.insert(auditEvents).values({ userId: req.userId, event: "program.block_changed", targetType: "workout_program", targetId: id, metadata: body });
      return { blockWeeks: body.blockWeeks, blockStart, block: blockPosition(blockStart, body.blockWeeks, today) };
    });
  });

  /** Schedule (or cancel with null) a one-off deload week starting the Monday of `weekOf`. */
  app.put("/v1/programs/:id/deload", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(z.object({ weekOf: z.iso.date().nullable() }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [prog] = await tx.select().from(workoutPrograms).where(eq(workoutPrograms.id, id));
      if (!prog) throw notFound("Program");
      const deloadWeekStart = body.weekOf ? startOfIsoWeek(body.weekOf) : null;
      await tx.update(workoutPrograms).set({ deloadWeekStart, updatedAt: ctx.now() }).where(eq(workoutPrograms.id, id));
      await tx.insert(auditEvents).values({ userId: req.userId, event: "program.deload_scheduled", targetType: "workout_program", targetId: id, metadata: { deloadWeekStart } });
      return { deloadWeekStart };
    });
  });

  /** Is performance falling on the main lifts? Suggests a deload with its evidence; never schedules one itself. */
  app.get("/v1/training/fatigue", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const today = dayKeyInZone(ctx.now(), (await getProfile(tx, req.userId)).timeZone);
      const recent = await tx
        .select({ exerciseId: sessionExercises.exerciseId, name: exercises.name, n: sql<number>`count(distinct ${workoutSessions.id})::int` })
        .from(sessionExercises)
        .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
        .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
        .where(and(eq(workoutSessions.userId, req.userId), eq(workoutSessions.status, "completed"), isNull(workoutSessions.deletedAt), gte(workoutSessions.day, addDays(today, -42)), eq(exercises.mechanics, "compound")))
        .groupBy(sessionExercises.exerciseId, exercises.name)
        .orderBy(desc(sql`count(distinct ${workoutSessions.id})`))
        .limit(4);
      const lifts = [];
      for (const r of recent) if (r.n >= 3) lifts.push({ exerciseName: r.name, sessions: await exerciseHistory(tx, req.userId, r.exerciseId, { limit: 3 }) });
      const recovery = await recoverySnapshot(tx, req.userId, today);
      return { ...assessFatigue(lifts, recovery.readiness), liftsChecked: lifts.map((l) => l.exerciseName), readiness: recovery.readiness };
    }),
  );

  /* ── Sessions ── */

  /** Idempotent full-snapshot upsert of a workout (works for offline replays). */
  app.put("/v1/workouts/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(WorkoutUpsert, req.body);
    return ctx.db.asUser(req.userId, (tx) => upsertWorkout(tx, req.userId, id, body, ctx.now()));
  });

  app.get("/v1/workouts/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const s = await loadSession(tx, id);
      if (!s) throw notFound("Workout");
      return s;
    });
  });

  app.get("/v1/workouts", auth, async (req) => {
    const q = parse(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, req.userId), isNull(workoutSessions.deletedAt), q.from ? gte(workoutSessions.day, q.from) : undefined, q.to ? lte(workoutSessions.day, q.to) : undefined))
        .orderBy(desc(workoutSessions.startedAt))
        .limit(q.limit);
      return { items: rows.map((r) => ({ id: r.id, name: r.name, day: r.day, status: r.status, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, summary: r.summary, templateId: r.templateId })) };
    });
  });

  /** Weekly sets per muscle, frequency, and strength trends. */
  app.get("/v1/training/analytics", auth, async (req) => {
    const q = parse(z.object({ weeks: z.coerce.number().int().min(1).max(52).default(8) }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const from = startOfIsoWeek(addDays(today, -7 * (q.weeks - 1)));
      const rows = await tx
        .select({ day: workoutSessions.day, sessionId: workoutSessions.id, exerciseId: sessionExercises.exerciseId, set: setLogs })
        .from(setLogs)
        .innerJoin(sessionExercises, eq(sessionExercises.id, setLogs.sessionExerciseId))
        .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
        .where(and(eq(setLogs.userId, req.userId), eq(workoutSessions.status, "completed"), isNull(workoutSessions.deletedAt), gte(workoutSessions.day, from)));
      const exIds = [...new Set(rows.map((r) => r.exerciseId))];
      const exRows = exIds.length ? await tx.select().from(exercises).where(inArray(exercises.id, exIds)) : [];
      const exMap = new Map(exRows.map((e) => [e.id, e]));
      const logs = new Map<string, { exerciseId: string; day: string; sets: LoggedSet[] }>();
      for (const r of rows) {
        const key = `${r.sessionId}:${r.exerciseId}`;
        const l = logs.get(key) ?? { exerciseId: r.exerciseId, day: r.day, sets: [] };
        l.sets.push(rowToSet(r.set));
        logs.set(key, l);
      }
      const weekly = weeklySetsPerMuscle([...logs.values()], (id) => {
        const e = exMap.get(id);
        return e ? { primary: e.primaryMuscles, secondary: e.secondaryMuscles } : undefined;
      });
      const sessions = sessionsPerWeek([...new Set(rows.map((r) => `${r.day}|${r.sessionId}`))].map((k) => k.split("|")[0]!));
      const trends = exIds
        .map((id) => {
          const pts = [...logs.values()].filter((l) => l.exerciseId === id).map((l) => ({ day: l.day, e1rmKg: bestE1rm(l.sets) })).filter((x) => x.e1rmKg !== null).sort((a, b) => (a.day < b.day ? -1 : 1));
          return { exerciseId: id, name: exMap.get(id)?.name ?? "", points: pts };
        })
        .filter((t) => t.points.length >= 2)
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, 8);
      return {
        from,
        weeks: [...weekly.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, m]) => ({ week, sessions: sessions.get(week) ?? 0, setsPerMuscle: Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])) })),
        strengthTrends: trends,
        notes: ["Sets per muscle count primary muscles fully and secondary muscles as half a set — a rough guide, not a precise measure."],
      };
    });
  });

}

export async function buildProgramProposal(tx: Tx, userId: string, body: { preferredDays?: number[]; sessionMinutes?: number; equipment?: string[]; goal?: TrainingGoal }) {
  const p = await getProfile(tx, userId);
  const training = TrainingPreferences.parse(p.training ?? {});
  const [primaryGoal] = await tx.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"))).orderBy(asc(goals.priority)).limit(1);
  const goal = body.goal ?? trainingGoalFor(primaryGoal?.kind ?? "general_fitness");
  const split = suggestSplit(body.preferredDays ?? training.preferredDays, training.experience, primaryGoal?.kind === "endurance");
  const allEquipment = ["barbell", "dumbbell", "kettlebell", "machine", "cable", "bodyweight", "band", "smith_machine", "cardio_machine", "pullup_bar"];
  const equipment = body.equipment ?? (training.gymAccess === "commercial_gym" ? allEquipment : training.equipment.length ? training.equipment : ["bodyweight", "dumbbell"]);
  const catalogue = (await tx.select().from(exercises)).map((e): CatalogueExercise => ({ id: e.id, slug: e.slug, name: e.name, pattern: e.movementPattern, primaryMuscles: e.primaryMuscles, equipment: e.equipment, mechanics: e.mechanics, difficulty: e.difficulty, category: e.category, loadProfile: e.loadProfile }));
  const disliked = new Set(training.dislikedExercises.map((d) => d.toLowerCase()));
  const excluded = catalogue.filter((e) => disliked.has(e.name.toLowerCase()) || disliked.has(e.slug)).map((e) => e.slug);
  const liked = catalogue.filter((e) => training.likedExercises.map((l) => l.toLowerCase()).includes(e.name.toLowerCase())).map((e) => e.slug);
  const days = generateProgram({ split, catalogue, equipment, experience: training.experience, sessionMinutes: body.sessionMinutes ?? training.sessionMinutes, goal, likedSlugs: liked, excludedSlugs: excluded });
  const splitKind = split.split === "full_body" ? "full_body" : split.split === "upper_lower" ? "upper_lower" : split.split === "push_pull_legs" ? "push_pull_legs" : "hybrid";
  return {
    draft: {
      name: `${split.dayNames.length}-day ${splitKind.replace(/_/g, " ")}`,
      split: splitKind,
      // 4 build weeks then a deload week; the user can change or switch this off.
      blockWeeks: 5,
      notes: `${split.rationale} ${goalTrainingRationale(goal)}`,
      days: days.map((d) => ({ name: d.name, weekday: d.weekday, exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, prescription: PrescriptionSchema.parse(e.prescription) })) })),
    },
    preview: days,
    rationale: `${split.rationale} ${goalTrainingRationale(goal)}`,
    focus: goal,
    limitationsNote: training.limitations ? "You listed movement limitations. Review each exercise and swap anything that is uncomfortable; the generator does not interpret medical conditions." : null,
  };
}
