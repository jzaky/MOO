import { FoodLogUpsert, SavedMealCreate, SavedMealLogRequest, WaterLogUpsert, type PortionDto } from "@moo/contracts";
import {
  clampClientTimestamp,
  DEFAULT_MEALS,
  isKnown,
  nutrientsForPortion,
  PortionError,
  summarizeDay,
  type NutrientValues,
  type PortionInput,
} from "@moo/core";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { diaryDays, foodLogs, recipes, savedMeals, waterLogs } from "../db/schema";
import { loadFood, loadFoods, toNutritionBasis, type FoodDto } from "../foods/repository";
import { badRequest, conflict, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { deterministicUuid, isUniqueViolation } from "../util/ids";
import { currentTargets } from "./profile";

type FoodLogRow = typeof foodLogs.$inferSelect;

export function foodLogToDto(r: FoodLogRow) {
  return {
    id: r.id,
    day: r.day,
    loggedAt: r.loggedAt.toISOString(),
    meal: r.meal,
    foodId: r.foodId,
    recipeId: r.recipeId,
    savedMealId: r.savedMealId,
    recognitionId: r.recognitionId,
    description: r.description,
    portion: r.portion,
    baseAmount: r.baseAmount,
    baseUnit: r.baseUnit,
    nutrients: r.nutrients as NutrientValues,
    provenance: r.provenance,
    note: r.note,
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    version: r.version,
  };
}

function describePortion(food: FoodDto, portion: PortionDto): string {
  if (portion.kind === "serving") {
    const s = food.servings.find((x) => x.id === portion.servingId);
    return `${portion.quantity} × ${s?.label ?? "serving"}`;
  }
  return `${Math.round(portion.quantity * 10) / 10} ${portion.unit}`;
}

/** Compute the nutrient snapshot for a food + portion. All arithmetic in @moo/core. */
export function computeFoodEntry(food: FoodDto, portion: PortionDto) {
  try {
    const { baseAmount, nutrients } = nutrientsForPortion(toNutritionBasis(food), portion as PortionInput);
    return { baseAmount, baseUnit: food.baseUnit, nutrients, description: food.brand ? `${food.name} (${food.brand})` : food.name, portionText: describePortion(food, portion) };
  } catch (e) {
    if (e instanceof PortionError) throw badRequest(e.message);
    throw e;
  }
}

function defaultProvenance(food: FoodDto): "database" | "label" | "user" | "recipe" {
  if (food.source === "recipe") return "recipe";
  if (food.source === "label" || food.source === "ai_label") return "label";
  return food.isPrivate ? "user" : "database";
}

interface UpsertOutcome {
  entry: ReturnType<typeof foodLogToDto>;
  applied: boolean;
}

/** Idempotent, last-writer-wins upsert of a diary entry. */
export async function upsertFoodLog(tx: Tx, userId: string, id: string, body: z.infer<typeof FoodLogUpsert>, now: Date, extra: { savedMealId?: string | null } = {}): Promise<UpsertOutcome> {
  const clientUpdatedAt = new Date(clampClientTimestamp(body.clientUpdatedAt, now));
  let computed: { description: string; nutrients: NutrientValues; baseAmount: number | null; baseUnit: string | null; provenance: string; foodId: string | null; recipeId: string | null };
  if (body.recipeId) {
    const [r] = await tx.select().from(recipes).where(and(eq(recipes.id, body.recipeId), isNull(recipes.deletedAt)));
    if (!r?.foodId) throw notFound("Recipe");
    const food = await loadFood(tx, r.foodId);
    const c = computeFoodEntry(food, body.portion!);
    computed = { ...c, provenance: "recipe", foodId: food.id, recipeId: r.id };
  } else if (body.foodId) {
    const food = await loadFood(tx, body.foodId);
    const c = computeFoodEntry(food, body.portion!);
    computed = { ...c, provenance: body.provenance === "ai_estimate" ? "ai_estimate" : defaultProvenance(food), foodId: food.id, recipeId: null };
  } else {
    const n = body.nutrients as NutrientValues;
    if (!isKnown(n.energyKcal)) throw badRequest("Quick add requires at least an energy value");
    // A quick add keeps the "estimate" label when its numbers came from AI (e.g. a restaurant menu).
    computed = { description: body.description!, nutrients: n, baseAmount: null, baseUnit: null, provenance: body.provenance === "ai_estimate" ? "ai_estimate" : "user", foodId: null, recipeId: null };
  }

  const [existing] = await tx.select().from(foodLogs).where(eq(foodLogs.id, id));
  if (existing && existing.clientUpdatedAt.getTime() >= clientUpdatedAt.getTime()) {
    return { entry: foodLogToDto(existing), applied: false };
  }
  const values = {
    id,
    userId,
    day: body.day,
    loggedAt: new Date(body.loggedAt),
    meal: body.meal,
    foodId: computed.foodId,
    recipeId: computed.recipeId,
    savedMealId: extra.savedMealId ?? existing?.savedMealId ?? null,
    recognitionId: body.recognitionId ?? existing?.recognitionId ?? null,
    description: computed.description,
    portion: body.portion ?? null,
    baseAmount: computed.baseAmount,
    baseUnit: computed.baseUnit,
    nutrients: computed.nutrients,
    provenance: computed.provenance,
    note: body.note ?? null,
    clientUpdatedAt,
    deletedAt: null,
    updatedAt: now,
  };
  try {
    if (existing) {
      const [row] = await tx.update(foodLogs).set({ ...values, version: existing.version + 1 }).where(eq(foodLogs.id, id)).returning();
      return { entry: foodLogToDto(row!), applied: true };
    }
    const [row] = await tx.insert(foodLogs).values(values).returning();
    return { entry: foodLogToDto(row!), applied: true };
  } catch (e) {
    // Another user's row with the same id is invisible under RLS and surfaces as a PK conflict.
    if (isUniqueViolation(e)) throw conflict("This entry id is already in use");
    throw e;
  }
}

async function isDayComplete(tx: Tx, userId: string, day: string): Promise<"complete" | "incomplete" | null> {
  const [row] = await tx.select().from(diaryDays).where(and(eq(diaryDays.userId, userId), eq(diaryDays.day, day)));
  return (row?.status as "complete" | "incomplete" | undefined) ?? null;
}

export async function daySummary(tx: Tx, userId: string, day: string) {
  const entries = await tx.select().from(foodLogs).where(and(eq(foodLogs.userId, userId), eq(foodLogs.day, day), isNull(foodLogs.deletedAt))).orderBy(asc(foodLogs.loggedAt));
  const water = await tx.select().from(waterLogs).where(and(eq(waterLogs.userId, userId), eq(waterLogs.day, day), isNull(waterLogs.deletedAt))).orderBy(asc(waterLogs.loggedAt));
  const t = await currentTargets(tx, userId, day);
  const targets = t ? { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, ...(t.fiberG != null ? { fiberG: t.fiberG } : {}) } : null;
  const meals = [...DEFAULT_MEALS, ...new Set(entries.map((e) => e.meal).filter((m) => !(DEFAULT_MEALS as readonly string[]).includes(m)))];
  const summary = summarizeDay(
    entries.map((e) => ({ id: e.id, meal: e.meal, nutrients: e.nutrients as NutrientValues, loggedAt: e.loggedAt.toISOString() })),
    targets ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    meals,
  );
  return {
    day,
    entries: entries.map(foodLogToDto),
    meals: summary.meals.map((m) => ({ meal: m.meal, entryCount: m.entryCount, energyKcal: m.totals.energyKcal.value, proteinG: m.totals.proteinG.value, carbsG: m.totals.carbsG.value, fatG: m.totals.fatG.value })),
    totals: summary.totals,
    progress: targets ? summary.progress : [],
    targets: t ? { energyKcal: t.energyKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fiberG: t.fiberG, waterMl: t.waterMl, basis: t.basis } : null,
    water: { totalMl: water.reduce((a, w) => a + w.ml, 0), targetMl: t?.waterMl ?? null, entries: water.map((w) => ({ id: w.id, ml: w.ml, loggedAt: w.loggedAt.toISOString() })) },
    status: await isDayComplete(tx, userId, day),
  };
}

const IdParam = z.object({ id: z.uuid() });
const DayParam = z.object({ day: z.iso.date() });

export function registerDiaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  app.put("/v1/food-logs/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(FoodLogUpsert, req.body);
    return ctx.db.asUser(req.userId, (tx) => upsertFoodLog(tx, req.userId, id, body, ctx.now()));
  });

  app.delete("/v1/food-logs/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { clientUpdatedAt } = parse(z.object({ clientUpdatedAt: z.iso.datetime({ offset: true }) }), req.query);
    await ctx.db.asUser(req.userId, async (tx) => {
      const [existing] = await tx.select().from(foodLogs).where(eq(foodLogs.id, id));
      if (!existing) return; // deleting something unknown is a no-op (idempotent)
      const ts = new Date(clampClientTimestamp(clientUpdatedAt, ctx.now()));
      if (existing.clientUpdatedAt.getTime() > ts.getTime()) return;
      await tx.update(foodLogs).set({ deletedAt: ctx.now(), clientUpdatedAt: ts, version: existing.version + 1, updatedAt: ctx.now() }).where(eq(foodLogs.id, id));
    });
    return reply.status(204).send();
  });

  app.get("/v1/diary/:day", auth, async (req) => {
    const { day } = parse(DayParam, req.params);
    return ctx.db.asUser(req.userId, (tx) => daySummary(tx, req.userId, day));
  });

  app.put("/v1/diary/:day/status", auth, async (req) => {
    const { day } = parse(DayParam, req.params);
    const { status } = parse(z.object({ status: z.enum(["complete", "incomplete"]) }), req.body);
    await ctx.db.asUser(req.userId, (tx) =>
      tx.insert(diaryDays).values({ userId: req.userId, day, status }).onConflictDoUpdate({ target: [diaryDays.userId, diaryDays.day], set: { status, updatedAt: ctx.now() } }),
    );
    return { day, status };
  });

  /** Daily totals for a range (weekly averages, analytics). */
  app.get("/v1/diary", auth, async (req) => {
    const q = parse(z.object({ from: z.iso.date(), to: z.iso.date() }), req.query);
    if (q.from > q.to) throw badRequest("from must be before to");
    return ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx
        .select({
          day: foodLogs.day,
          entries: sql<number>`count(*)::int`,
          energyKcal: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'energyKcal')::float8), 0)`,
          proteinG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'proteinG')::float8), 0)`,
          carbsG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'carbsG')::float8), 0)`,
          fatG: sql<number>`coalesce(sum((${foodLogs.nutrients}->>'fatG')::float8), 0)`,
          fiberG: sql<number | null>`sum((${foodLogs.nutrients}->>'fiberG')::float8)`,
          meals: sql<number>`count(distinct ${foodLogs.meal})::int`,
        })
        .from(foodLogs)
        .where(and(eq(foodLogs.userId, req.userId), gte(foodLogs.day, q.from), lte(foodLogs.day, q.to), isNull(foodLogs.deletedAt)))
        .groupBy(foodLogs.day)
        .orderBy(asc(foodLogs.day));
      const statuses = await tx.select().from(diaryDays).where(and(eq(diaryDays.userId, req.userId), gte(diaryDays.day, q.from), lte(diaryDays.day, q.to)));
      const st = new Map(statuses.map((s) => [s.day, s.status]));
      return { days: rows.map((r) => ({ ...r, status: st.get(r.day) ?? null })) };
    });
  });

  /** Copy a day or meal to another day/meal. Deterministic ids make replays harmless. */
  app.post("/v1/diary/copy", auth, async (req) => {
    const body = parse(z.object({ fromDay: z.iso.date(), fromMeal: z.string().max(40).optional(), toDay: z.iso.date(), toMeal: z.string().max(40).optional(), loggedAt: z.iso.datetime({ offset: true }) }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const src = await tx.select().from(foodLogs).where(and(eq(foodLogs.userId, req.userId), eq(foodLogs.day, body.fromDay), isNull(foodLogs.deletedAt), ...(body.fromMeal ? [eq(foodLogs.meal, body.fromMeal)] : [])));
      const created = [];
      for (const s of src) {
        const id = deterministicUuid(req.userId, `copy:${s.id}:${body.toDay}:${body.toMeal ?? s.meal}`);
        const [exists] = await tx.select({ id: foodLogs.id }).from(foodLogs).where(eq(foodLogs.id, id));
        if (exists) continue;
        const [row] = await tx
          .insert(foodLogs)
          .values({ ...s, id, day: body.toDay, meal: body.toMeal ?? s.meal, loggedAt: new Date(body.loggedAt), clientUpdatedAt: ctx.now(), version: 1, createdAt: ctx.now(), updatedAt: ctx.now() })
          .returning();
        created.push(foodLogToDto(row!));
      }
      return { created };
    });
  });

  app.put("/v1/water-logs/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(WaterLogUpsert, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const ts = new Date(clampClientTimestamp(body.clientUpdatedAt, ctx.now()));
      const [existing] = await tx.select().from(waterLogs).where(eq(waterLogs.id, id));
      if (existing && existing.clientUpdatedAt >= ts) return { id, applied: false };
      try {
        await tx
          .insert(waterLogs)
          .values({ id, userId: req.userId, day: body.day, loggedAt: new Date(body.loggedAt), ml: body.ml, clientUpdatedAt: ts })
          .onConflictDoUpdate({ target: waterLogs.id, set: { day: body.day, loggedAt: new Date(body.loggedAt), ml: body.ml, clientUpdatedAt: ts, deletedAt: null, version: sql`${waterLogs.version} + 1`, updatedAt: ctx.now() } });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("This entry id is already in use");
        throw e;
      }
      return { id, applied: true };
    });
  });

  app.delete("/v1/water-logs/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.update(waterLogs).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(waterLogs.id, id)));
    return reply.status(204).send();
  });

  /* ── Saved meals ── */

  app.get("/v1/saved-meals", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(savedMeals).where(and(eq(savedMeals.userId, req.userId), isNull(savedMeals.deletedAt))).orderBy(sql`${savedMeals.lastUsedAt} desc nulls last`, asc(savedMeals.name));
      const foods = await loadFoods(tx, rows.flatMap((r) => (r.items as { foodId: string }[]).map((i) => i.foodId)));
      return {
        items: rows.map((r) => {
          const items = (r.items as { foodId: string; portion: PortionDto }[]).map((i) => {
            const food = foods.get(i.foodId);
            return food ? { foodId: i.foodId, portion: i.portion, ...computeFoodEntry(food, i.portion) } : { foodId: i.foodId, portion: i.portion, missing: true };
          });
          const energy = items.reduce((a, i) => a + ("nutrients" in i && isKnown(i.nutrients.energyKcal) ? i.nutrients.energyKcal : 0), 0);
          return { id: r.id, name: r.name, defaultMeal: r.defaultMeal, useCount: r.useCount, lastUsedAt: r.lastUsedAt?.toISOString() ?? null, items, energyKcal: energy };
        }),
      };
    }),
  );

  app.post("/v1/saved-meals", auth, async (req, reply) => {
    const body = parse(SavedMealCreate, req.body);
    const row = await ctx.db.asUser(req.userId, async (tx) => {
      const foods = await loadFoods(tx, body.items.map((i) => i.foodId));
      for (const i of body.items) {
        const f = foods.get(i.foodId);
        if (!f) throw notFound(`Food ${i.foodId}`);
        computeFoodEntry(f, i.portion); // validates portions now rather than at log time
      }
      const [r] = await tx.insert(savedMeals).values({ userId: req.userId, name: body.name, defaultMeal: body.defaultMeal ?? null, items: body.items }).returning();
      return r!;
    });
    return reply.status(201).send({ id: row.id, name: row.name });
  });

  /** Save an existing diary meal as a reusable saved meal. */
  app.post("/v1/saved-meals/from-diary", auth, async (req, reply) => {
    const body = parse(z.object({ day: z.iso.date(), meal: z.string().max(40), name: z.string().trim().min(1).max(120) }), req.body);
    const row = await ctx.db.asUser(req.userId, async (tx) => {
      const logs = await tx.select().from(foodLogs).where(and(eq(foodLogs.userId, req.userId), eq(foodLogs.day, body.day), eq(foodLogs.meal, body.meal), isNull(foodLogs.deletedAt)));
      const items = logs.filter((l) => l.foodId && l.portion).map((l) => ({ foodId: l.foodId!, portion: l.portion }));
      if (!items.length) throw badRequest("That meal has no database foods to save");
      const [r] = await tx.insert(savedMeals).values({ userId: req.userId, name: body.name, defaultMeal: body.meal, items }).returning();
      return r!;
    });
    return reply.status(201).send({ id: row.id, name: row.name });
  });

  app.delete("/v1/saved-meals/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.update(savedMeals).set({ deletedAt: ctx.now() }).where(eq(savedMeals.id, id)));
    return reply.status(204).send();
  });

  app.post("/v1/saved-meals/:id/log", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(SavedMealLogRequest, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [m] = await tx.select().from(savedMeals).where(and(eq(savedMeals.id, id), isNull(savedMeals.deletedAt)));
      if (!m) throw notFound("Saved meal");
      const prefix = body.idPrefix ?? deterministicUuid(id, `${body.day}:${body.meal}:${body.loggedAt}`);
      const entries = [];
      let applied = false;
      for (const [i, item] of (m.items as { foodId: string; portion: PortionDto }[]).entries()) {
        const portion = { ...item.portion, quantity: item.portion.quantity * body.scale } as PortionDto;
        const out = await upsertFoodLog(tx, req.userId, deterministicUuid(prefix, String(i)), { day: body.day, meal: body.meal, loggedAt: body.loggedAt, clientUpdatedAt: body.loggedAt, foodId: item.foodId, portion }, ctx.now(), { savedMealId: id });
        entries.push(out.entry);
        applied ||= out.applied;
      }
      if (applied) await tx.update(savedMeals).set({ useCount: m.useCount + 1, lastUsedAt: ctx.now() }).where(eq(savedMeals.id, id));
      return { entries };
    });
  });
}
