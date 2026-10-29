import { NotificationPreferences } from "@moo/contracts";
import { analyzeMovement, dayKeyInZone, localTimeToUtc, planNotifications, type Frame } from "@moo/core";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import * as schema from "../db/schema";
import { parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { getProfile } from "./profile";

/** Tables included in a personal data export (everything owned by the user). */
const EXPORT_TABLES = {
  profile: schema.profiles,
  goals: schema.goals,
  nutritionTargets: schema.nutritionTargets,
  privateFoods: schema.foods,
  foodLogs: schema.foodLogs,
  waterLogs: schema.waterLogs,
  diaryDays: schema.diaryDays,
  savedMeals: schema.savedMeals,
  recipes: schema.recipes,
  recipeIngredients: schema.recipeIngredients,
  workoutPrograms: schema.workoutPrograms,
  workoutTemplates: schema.workoutTemplates,
  templateExercises: schema.templateExercises,
  workoutSessions: schema.workoutSessions,
  sessionExercises: schema.sessionExercises,
  setLogs: schema.setLogs,
  personalRecords: schema.personalRecords,
  bodyMeasurements: schema.bodyMeasurements,
  progressPhotos: schema.progressPhotos,
  healthObservations: schema.healthObservations,
  dailyCheckins: schema.dailyCheckins,
  coachConversations: schema.coachConversations,
  coachMessages: schema.coachMessages,
  coachRecommendations: schema.coachRecommendations,
  coachActions: schema.coachActions,
  mealPlans: schema.mealPlans,
  mealPlanItems: schema.mealPlanItems,
  groceryLists: schema.groceryLists,
  groceryItems: schema.groceryItems,
  pantryItems: schema.pantryItems,
  notificationPreferences: schema.notificationPreferences,
} as const;

export async function buildExport(tx: Tx, userId: string) {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(EXPORT_TABLES)) {
    const rows = (await tx.select().from(table as typeof schema.goals)) as Record<string, unknown>[];
    // Shared catalogue foods are not the user's data; keep only private rows.
    out[name] = name === "privateFoods" ? rows.filter((r) => r.ownerUserId === userId) : name === "coachMessages" ? rows.map(({ providerContent, ...r }) => r) : rows;
  }
  return out;
}

export async function notificationPlan(tx: Tx, userId: string, now: Date, days = 7) {
  const p = await getProfile(tx, userId);
  const [prefsRow] = await tx.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  const prefs = NotificationPreferences.parse(prefsRow?.settings ?? {});
  const [program] = await tx.select().from(schema.workoutPrograms).where(and(eq(schema.workoutPrograms.userId, userId), eq(schema.workoutPrograms.status, "active"))).limit(1);
  const templates = program ? await tx.select().from(schema.workoutTemplates).where(and(eq(schema.workoutTemplates.programId, program.id), isNull(schema.workoutTemplates.deletedAt))) : [];
  const today = dayKeyInZone(now, p.timeZone);
  const sessions = await tx.select({ day: schema.workoutSessions.day }).from(schema.workoutSessions).where(and(eq(schema.workoutSessions.userId, userId), eq(schema.workoutSessions.status, "completed")));
  const plan = planNotifications(
    prefs,
    { timeZone: p.timeZone, plannedWorkouts: templates.filter((t) => t.weekday).map((t) => ({ weekday: t.weekday!, name: t.name })), mealTimes: [{ meal: "breakfast", time: "08:00" }, { meal: "lunch", time: "13:00" }, { meal: "dinner", time: "19:30" }], completedWorkoutDays: sessions.map((s) => s.day) },
    today,
    days,
  );
  return plan.map((n) => ({ ...n, sendAt: localTimeToUtc(n.localDay, n.localTime, p.timeZone).toISOString() })).filter((n) => new Date(n.sendAt) > now);
}

/**
 * Expo push sender. Called by a scheduled job (see scripts/README); kept as a
 * pure function over fetch so it can be tested without network access.
 */
export async function sendExpoPush(tokens: string[], n: { title: string; body: string; data?: Record<string, unknown> }, fetchImpl: typeof fetch = fetch) {
  if (!tokens.length) return { sent: 0 };
  const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(tokens.map((to) => ({ to, title: n.title, body: n.body, data: n.data ?? {}, sound: null, priority: "normal" }))),
  });
  if (!res.ok) throw new Error(`Expo push failed with ${res.status}`);
  return { sent: tokens.length };
}

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  app.get("/v1/me/export", { ...auth, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const data = await ctx.db.asUser(req.userId, (tx) => buildExport(tx, req.userId));
    const user = await ctx.auth.getUser(req.userId);
    await ctx.db.asUser(req.userId, (tx) => tx.insert(schema.auditEvents).values({ userId: req.userId, event: "data.exported" }));
    return reply
      .header("Content-Disposition", `attachment; filename="moo-export-${new Date().toISOString().slice(0, 10)}.json"`)
      .send({ exportedAt: ctx.now().toISOString(), format: "moo-export/v1", account: user, data, notes: ["Progress photos are referenced by storage key; download them from the app while signed in.", "Shared food database records are not included; diary entries contain the nutrient values as logged."] });
  });

  app.post("/v1/push-tokens", auth, async (req, reply) => {
    const body = parse(z.object({ token: z.string().regex(/^ExponentPushToken\[[^\]]+\]$|^[A-Za-z0-9:_-]{20,300}$/), platform: z.enum(["ios", "android"]) }), req.body);
    // A device token can move between accounts (sign-out/sign-in); the owner connection releases it first.
    await ctx.db.system.delete(schema.pushTokens).where(eq(schema.pushTokens.token, body.token));
    await ctx.db.asUser(req.userId, (tx) => tx.insert(schema.pushTokens).values({ userId: req.userId, token: body.token, platform: body.platform }));
    return reply.status(204).send();
  });

  app.get("/v1/notifications/plan", auth, async (req) => ctx.db.asUser(req.userId, async (tx) => ({ items: await notificationPlan(tx, req.userId, ctx.now()) })));

  /**
   * Movement analysis from on-device pose landmarks (no video leaves the
   * device). Supported movements only; others are rejected explicitly.
   */
  app.post("/v1/movement/analyze", { ...auth, bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const body = parse(
      z.object({
        movement: z.enum(["squat", "push_up"]),
        frames: z.array(z.object({ tMs: z.number().min(0), landmarks: z.array(z.object({ x: z.number(), y: z.number(), z: z.number().optional(), visibility: z.number().min(0).max(1).optional() })).length(33) })).min(10).max(20000),
      }),
      req.body,
    );
    return analyzeMovement(body.movement, body.frames as Frame[]);
  });
}
