import { randomUUID } from "node:crypto";
import {
  AiDataConsent,
  DietaryPreferences,
  Lifestyle,
  ManualTargetsRequest,
  NotificationPreferences,
  OnboardingPlanRequest,
  ProfileUpdate,
  SetGoalsRequest,
  TrainingPreferences,
  type OnboardingPlanRequest as PlanReq,
} from "@stoke/contracts";
import { ageFromBirthDate, dayKeyInZone, DEFAULT_MEASUREMENT_SCHEDULE, generateTargets, goalTrainingRationale, isValidTimeZone, suggestSplit, type PrimaryGoal, type TrainingGoal } from "@stoke/core";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { auditEvents, bodyMeasurements, goals, notificationPreferences, nutritionTargets, profiles } from "../db/schema";
import { badRequest, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";

type ProfileRow = typeof profiles.$inferSelect;

export function profileToDto(p: ProfileRow) {
  return {
    displayName: p.displayName,
    birthDate: p.birthDate,
    sex: p.sex,
    heightCm: p.heightCm,
    unitSystem: p.unitSystem,
    timeZone: p.timeZone,
    country: p.country,
    activityLevel: p.activityLevel,
    dietary: DietaryPreferences.parse(p.dietary ?? {}),
    training: TrainingPreferences.parse(p.training ?? {}),
    lifestyle: Lifestyle.parse(p.lifestyle ?? {}),
    aiConsent: AiDataConsent.parse(p.aiConsent ?? {}),
    onboardingCompletedAt: p.onboardingCompletedAt?.toISOString() ?? null,
  };
}

export async function getProfile(tx: Tx, userId: string): Promise<ProfileRow> {
  const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
  if (!p) throw notFound("Profile");
  return p;
}

export async function currentTargets(tx: Tx, userId: string, onDay?: string) {
  const rows = await tx.select().from(nutritionTargets).where(eq(nutritionTargets.userId, userId)).orderBy(desc(nutritionTargets.effectiveFrom), desc(nutritionTargets.createdAt));
  // Days logged before the first target existed (e.g. backfilling) use the earliest target.
  return rows.find((r) => !onDay || r.effectiveFrom <= onDay) ?? rows.at(-1) ?? null;
}

export function targetsToDto(t: typeof nutritionTargets.$inferSelect) {
  return {
    id: t.id,
    effectiveFrom: t.effectiveFrom,
    energyKcal: t.energyKcal,
    proteinG: t.proteinG,
    carbsG: t.carbsG,
    fatG: t.fatG,
    fiberG: t.fiberG,
    waterMl: t.waterMl,
    basis: t.basis,
    estimatedTdeeKcal: t.estimatedTdeeKcal,
    note: t.note,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Targets for the user's stored goals, body and training, as onboarding would compute them today. */
async function recommendedTargets(tx: Tx, userId: string, now: Date) {
  const p = await getProfile(tx, userId);
  if (!p.birthDate || !p.sex || !p.heightCm || !p.activityLevel) throw badRequest("Finish your profile (birth date, sex, height, activity) first.");
  const active = await tx.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"))).orderBy(goals.priority);
  const [w] = await tx.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, "weight"))).orderBy(desc(bodyMeasurements.measuredAt)).limit(1);
  const [bf] = await tx.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, "body_fat_pct"))).orderBy(desc(bodyMeasurements.measuredAt)).limit(1);
  if (!w) throw badRequest("Log your weight first.");
  const training = TrainingPreferences.parse(p.training ?? {});
  const primary = active[0];
  const goalKind = (primary?.kind ?? "maintain") as PrimaryGoal;
  const targets = generateTargets(
    { sex: p.sex as "male" | "female", ageYears: ageFromBirthDate(p.birthDate, now), heightCm: p.heightCm, weightKg: w.value, bodyFatPct: bf?.value ?? null },
    p.activityLevel as Parameters<typeof generateTargets>[1],
    {
      goal: goalKind,
      ...(primary?.weeklyRatePct != null ? { weeklyRatePct: primary.weeklyRatePct } : {}),
      experience: training.experience,
      secondaryGoals: active.slice(1).map((g) => g.kind as PrimaryGoal),
      trainingDaysPerWeek: training.preferredDays.length || 3,
    },
  );
  return { goal: goalKind, weightKg: w.value, targets: { ...targets, waterMl: Math.round((w.value * 33) / 50) * 50 } };
}

/** How a body-composition or performance goal is trained. */
export function trainingGoalFor(kind: string): TrainingGoal {
  switch (kind) {
    case "strength": return "strength";
    case "build_muscle": return "hypertrophy";
    case "lose_fat": return "fat_loss";
    case "recomposition": return "recomposition";
    case "endurance": return "endurance";
    default: return "general";
  }
}

function primaryGoal(req: Pick<PlanReq, "goals">): PlanReq["goals"][number] {
  return [...req.goals].sort((a, b) => a.priority - b.priority)[0]!;
}

/** Pure plan computation shared by preview and completion. */
export function buildPlan(req: PlanReq, now: Date) {
  const goal = primaryGoal(req);
  const age = ageFromBirthDate(req.birthDate, now);
  const targets = generateTargets(
    { sex: req.sex, ageYears: age, heightCm: req.heightCm, weightKg: req.weightKg, bodyFatPct: req.bodyFatPct ?? null },
    req.activityLevel,
    {
      goal: goal.kind as PrimaryGoal,
      ...(goal.weeklyRatePct != null ? { weeklyRatePct: goal.weeklyRatePct } : {}),
      experience: TrainingPreferences.parse(req.training ?? {}).experience,
      secondaryGoals: req.goals.filter((g) => g !== goal).map((g) => g.kind as PrimaryGoal),
      trainingDaysPerWeek: TrainingPreferences.parse(req.training ?? {}).preferredDays.length || 3,
    },
  );
  const training = TrainingPreferences.parse(req.training ?? {});
  const split = suggestSplit(training.preferredDays, training.experience, goal.kind === "endurance");
  const focus = trainingGoalFor(goal.kind);
  const stepsTarget = req.activityLevel === "sedentary" ? 7000 : req.activityLevel === "light" ? 8000 : 9000;
  return {
    targets: { ...targets, waterMl: Math.round((req.weightKg * 33) / 50) * 50 },
    training: { ...split, rationale: `${split.rationale} ${goalTrainingRationale(focus)}`, focus, sessionMinutes: training.sessionMinutes },
    activity: {
      dailyStepsTarget: stepsTarget,
      note: "A gradual daily step target supports energy expenditure and general health; increase it only if it stays comfortable.",
    },
    measurementSchedule: DEFAULT_MEASUREMENT_SCHEDULE,
    disclaimer:
      "These targets are estimates from standard equations. They will be refined from your logged intake and weight trend after a few weeks. This is not medical advice.",
  };
}

export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  app.get("/v1/profile", auth, async (req) => ctx.db.asUser(req.userId, async (tx) => profileToDto(await getProfile(tx, req.userId))));

  app.put("/v1/profile", auth, async (req) => {
    const body = parse(ProfileUpdate, req.body);
    if (body.timeZone && !isValidTimeZone(body.timeZone)) throw badRequest("Unknown time zone");
    return ctx.db.asUser(req.userId, async (tx) => {
      const [p] = await tx
        .update(profiles)
        .set({ ...body, updatedAt: ctx.now() })
        .where(eq(profiles.userId, req.userId))
        .returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "profile.updated", metadata: { fields: Object.keys(body) } });
      return profileToDto(p!);
    });
  });

  app.put("/v1/profile/ai-consent", auth, async (req) => {
    const body = parse(AiDataConsent, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [p] = await tx.update(profiles).set({ aiConsent: body, updatedAt: ctx.now() }).where(eq(profiles.userId, req.userId)).returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "ai_consent.updated", metadata: body });
      return profileToDto(p!).aiConsent;
    });
  });

  app.post("/v1/onboarding/plan", auth, async (req) => buildPlan(parse(OnboardingPlanRequest, req.body), ctx.now()));

  app.post("/v1/onboarding/complete", auth, async (req) => {
    const body = parse(
      OnboardingPlanRequest.extend({
        timeZone: z.string().min(1).max(64),
        unitSystem: z.enum(["metric", "imperial"]),
        country: z.string().length(2).nullable().optional(),
        displayName: z.string().trim().min(1).max(80).nullable().optional(),
        dietary: DietaryPreferences.partial().optional(),
        lifestyle: Lifestyle.partial().optional(),
        /** Optional user edits to the generated targets. */
        targetOverrides: ManualTargetsRequest.partial().optional(),
      }),
      req.body,
    );
    if (!isValidTimeZone(body.timeZone)) throw badRequest("Unknown time zone");
    const plan = buildPlan(body, ctx.now());
    const today = dayKeyInZone(ctx.now(), body.timeZone);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [p] = await tx
        .update(profiles)
        .set({
          displayName: body.displayName ?? null,
          birthDate: body.birthDate,
          sex: body.sex,
          heightCm: body.heightCm,
          activityLevel: body.activityLevel,
          timeZone: body.timeZone,
          unitSystem: body.unitSystem,
          country: body.country?.toUpperCase() ?? null,
          training: TrainingPreferences.parse(body.training ?? {}),
          dietary: DietaryPreferences.parse(body.dietary ?? {}),
          lifestyle: Lifestyle.parse(body.lifestyle ?? {}),
          onboardingCompletedAt: ctx.now(),
          updatedAt: ctx.now(),
        })
        .where(eq(profiles.userId, req.userId))
        .returning();
      await tx.update(goals).set({ status: "archived", endedAt: ctx.now() }).where(and(eq(goals.userId, req.userId), eq(goals.status, "active")));
      await tx.insert(goals).values(body.goals.map((g) => ({ userId: req.userId, kind: g.kind, priority: g.priority, targetWeightKg: g.targetWeightKg ?? null, weeklyRatePct: g.weeklyRatePct ?? null, targetDate: g.targetDate ?? null, notes: g.notes ?? null })));
      const o = body.targetOverrides ?? {};
      const edited = Object.keys(o).length > 0;
      const [t] = await tx
        .insert(nutritionTargets)
        .values({
          userId: req.userId,
          effectiveFrom: today,
          energyKcal: o.energyKcal ?? plan.targets.energyKcal,
          proteinG: o.proteinG ?? plan.targets.proteinG,
          carbsG: o.carbsG ?? plan.targets.carbsG,
          fatG: o.fatG ?? plan.targets.fatG,
          fiberG: o.fiberG ?? plan.targets.fiberG,
          waterMl: o.waterMl ?? plan.targets.waterMl,
          basis: edited ? "manual" : "estimated",
          estimatedTdeeKcal: plan.targets.estimatedTdeeKcal,
          note: edited ? "Edited during onboarding" : "Generated during onboarding",
        })
        .returning();
      await tx.insert(bodyMeasurements).values({ id: randomUUID(), userId: req.userId, day: today, measuredAt: ctx.now(), kind: "weight", value: body.weightKg, clientUpdatedAt: ctx.now(), source: "manual", note: "Onboarding" });
      if (body.bodyFatPct != null) {
        await tx.insert(bodyMeasurements).values({ id: randomUUID(), userId: req.userId, day: today, measuredAt: ctx.now(), kind: "body_fat_pct", value: body.bodyFatPct, clientUpdatedAt: ctx.now(), source: "manual", note: "Onboarding estimate" });
      }
      await tx.insert(auditEvents).values({ userId: req.userId, event: "onboarding.completed" });
      return { profile: profileToDto(p!), targets: targetsToDto(t!), plan };
    });
  });

  app.get("/v1/goals", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => ({ goals: await tx.select().from(goals).where(and(eq(goals.userId, req.userId), eq(goals.status, "active"))).orderBy(goals.priority) })),
  );

  app.put("/v1/goals", auth, async (req) => {
    const body = parse(SetGoalsRequest, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      await tx.update(goals).set({ status: "archived", endedAt: ctx.now() }).where(and(eq(goals.userId, req.userId), eq(goals.status, "active")));
      const rows = await tx.insert(goals).values(body.goals.map((g) => ({ userId: req.userId, kind: g.kind, priority: g.priority, targetWeightKg: g.targetWeightKg ?? null, weeklyRatePct: g.weeklyRatePct ?? null, targetDate: g.targetDate ?? null, notes: g.notes ?? null }))).returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "goals.updated" });
      return { goals: rows };
    });
  });

  app.get("/v1/nutrition/targets", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const history = await tx.select().from(nutritionTargets).where(eq(nutritionTargets.userId, req.userId)).orderBy(desc(nutritionTargets.effectiveFrom), desc(nutritionTargets.createdAt)).limit(50);
      const current = await currentTargets(tx, req.userId, today);
      return { current: current ? targetsToDto(current) : null, history: history.map(targetsToDto) };
    }),
  );

  /** What the targets would be for the current goals, body and training, with the reasons. Changes nothing. */
  app.get("/v1/nutrition/targets/recommended", auth, async (req) => ctx.db.asUser(req.userId, (tx) => recommendedTargets(tx, req.userId, ctx.now())));

  /** Apply the recommendation as a new version from today (after the user has seen it). */
  app.post("/v1/nutrition/targets/recalculate", auth, async (req, reply) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const r = await recommendedTargets(tx, req.userId, ctx.now());
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const t = r.targets;
      const [row] = await tx
        .insert(nutritionTargets)
        .values({ userId: req.userId, effectiveFrom: today, energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fiberG: t.fiberG, waterMl: t.waterMl, basis: "estimated", estimatedTdeeKcal: t.estimatedTdeeKcal, note: `Recalculated for goal: ${r.goal}` })
        .returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "targets.recalculated", targetType: "nutrition_targets", targetId: row!.id, metadata: { goal: r.goal } });
      return reply.status(201).send(targetsToDto(row!));
    }),
  );

  /** Manual edit: inserts a new version; never rewrites history. */
  app.post("/v1/nutrition/targets", auth, async (req, reply) => {
    const body = parse(ManualTargetsRequest, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const effectiveFrom = body.effectiveFrom ?? dayKeyInZone(ctx.now(), p.timeZone);
      const prev = await currentTargets(tx, req.userId, effectiveFrom);
      const [t] = await tx
        .insert(nutritionTargets)
        .values({ userId: req.userId, effectiveFrom, energyKcal: body.energyKcal, proteinG: body.proteinG, carbsG: body.carbsG, fatG: body.fatG, fiberG: body.fiberG, waterMl: body.waterMl ?? prev?.waterMl ?? null, basis: "manual", estimatedTdeeKcal: prev?.estimatedTdeeKcal ?? null, note: body.note ?? null })
        .returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "targets.manual_update", targetType: "nutrition_targets", targetId: t!.id });
      return reply.status(201).send(targetsToDto(t!));
    });
  });

  app.get("/v1/notification-preferences", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const [row] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, req.userId));
      return NotificationPreferences.parse(row?.settings ?? {});
    }),
  );

  app.put("/v1/notification-preferences", auth, async (req) => {
    const body = parse(NotificationPreferences, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      await tx.insert(notificationPreferences).values({ userId: req.userId, settings: body }).onConflictDoUpdate({ target: notificationPreferences.userId, set: { settings: body, updatedAt: ctx.now() } });
      return body;
    });
  });
}

