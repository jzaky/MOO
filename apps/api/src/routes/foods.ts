import { CustomFoodCreate, NutrientValuesSchema } from "@stoke/contracts";
import type { NutrientValues } from "@stoke/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditEvents, foodFavorites, foods, foodServings } from "../db/schema";
import { assessQuality, normalizeBarcode } from "../foods/normalize";
import { createPrivateFood, loadFood, loadFoods, searchLocalFoods, upsertSharedFood } from "../foods/repository";
import { badRequest, HttpError, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { getProfile } from "./profile";

/** Shared records older than this are refreshed from the source on lookup. */
const REVERIFY_AFTER_MS = 30 * 86_400_000;

/** Recent online searches → catalogue ids, so retyping doesn't re-query the providers. */
const onlineCache = new Map<string, { at: number; ids: string[] }>();

export function registerFoodRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  app.get("/v1/foods/search", auth, async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(100), remote: z.enum(["0", "1"]).default("1"), limit: z.coerce.number().int().min(1).max(50).default(25) }), req.query);
    const local = await ctx.db.asUser(req.userId, (tx) => searchLocalFoods(tx, req.userId, q.q, q.limit));
    let remoteError: string | null = null;
    if (q.remote === "1" && local.length < 8) {
      try {
        const country = await ctx.db.asUser(req.userId, async (tx) => (await getProfile(tx, req.userId)).country);
        const remote = await ctx.foodSources.search(q.q, { country: country ? `en:${countryName(country)}` : null, limit: 15 });
        for (const n of remote.filter((r) => r.quality.completeness > 0)) await upsertSharedFood(ctx.db.system, n, ctx.now());
      } catch (e) {
        remoteError = "Online food databases could not be reached; showing saved results only.";
        req.log.warn({ err: (e as Error).message }, "remote food search failed");
      }
      const merged = await ctx.db.asUser(req.userId, (tx) => searchLocalFoods(tx, req.userId, q.q, q.limit));
      return { results: merged, notice: remoteError };
    }
    return { results: local, notice: null };
  });

  /**
   * Online results (Open Food Facts, and USDA branded foods when a key is set),
   * saved to the shared catalogue so they are instant next time. Separate from
   * /search so typing never waits on the network; the app shows these below.
   */
  app.get("/v1/foods/search/online", auth, async (req) => {
    const q = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const country = await ctx.db.asUser(req.userId, async (tx) => (await getProfile(tx, req.userId)).country);
    const key = `${country ?? ""}|${q.q.toLowerCase()}`;
    const hit = onlineCache.get(key);
    let ids: string[];
    let notice: string | null = null;
    if (hit && Date.now() - hit.at < 10 * 60_000) ids = hit.ids;
    else {
      ids = [];
      try {
        const remote = await ctx.foodSources.search(q.q, { country: country ? `en:${countryName(country)}` : null, limit: 20 });
        for (const n of remote.filter((r) => r.quality.completeness > 0)) ids.push(await upsertSharedFood(ctx.db.system, n, ctx.now()));
        onlineCache.set(key, { at: Date.now(), ids });
        if (onlineCache.size > 500) onlineCache.delete(onlineCache.keys().next().value!);
      } catch (e) {
        notice = "Online food databases could not be reached; showing saved results only.";
        req.log.warn({ err: (e as Error).message }, "online food search failed");
      }
    }
    const foods = await ctx.db.asUser(req.userId, (tx) => loadFoods(tx, ids));
    return { results: ids.map((id) => foods.get(id)).filter(Boolean), notice };
  });

  app.get("/v1/foods/barcode/:code", auth, async (req) => {
    const { code } = parse(z.object({ code: z.string().min(6).max(20) }), req.params);
    const gtin = normalizeBarcode(code);
    if (!gtin) throw badRequest("That barcode is not valid (check digit mismatch). Try scanning again.");
    // 1) The user's own product (e.g. one they created from a label photo or corrected).
    const own = await ctx.db.asUser(req.userId, async (tx) => {
      const [row] = await tx.select().from(foods).where(and(eq(foods.ownerUserId, req.userId), eq(foods.barcode, gtin))).orderBy(desc(foods.updatedAt)).limit(1);
      return row ? loadFood(tx, row.id) : null;
    });
    if (own) return { food: own, origin: "private" };
    // 2) Cached shared record, if verified recently.
    const cached = await ctx.db.asUser(req.userId, async (tx) => {
      const [row] = await tx.select().from(foods).where(and(isNull(foods.ownerUserId), eq(foods.barcode, gtin))).limit(1);
      return row ?? null;
    });
    if (cached && cached.lastVerifiedAt && ctx.now().getTime() - cached.lastVerifiedAt.getTime() < REVERIFY_AFTER_MS) {
      return { food: await ctx.db.asUser(req.userId, (tx) => loadFood(tx, cached.id)), origin: "cache" };
    }
    // 3) External lookup.
    let normalized;
    try {
      normalized = await ctx.foodSources.lookupBarcode(gtin);
    } catch (e) {
      if (cached) return { food: await ctx.db.asUser(req.userId, (tx) => loadFood(tx, cached.id)), origin: "cache_stale" };
      throw e;
    }
    if (!normalized) {
      throw new HttpError(404, "barcode_not_found", "This product isn't in the food database yet. You can photograph the nutrition label or enter it manually.", { barcode: gtin });
    }
    const id = await upsertSharedFood(ctx.db.system, normalized, ctx.now());
    return { food: await ctx.db.asUser(req.userId, (tx) => loadFood(tx, id)), origin: "source" };
  });

  app.get("/v1/foods/recent", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      // Most recently logged foods with the portion used last time, for one-tap re-logging.
      const rows = await tx.execute<{ food_id: string; last_logged: Date; portion: unknown; meal: string; uses: number }>(sql`
        select distinct on (food_id) food_id, logged_at as last_logged, portion, meal,
          count(*) over (partition by food_id)::int as uses
        from food_logs
        where user_id = ${req.userId} and deleted_at is null and food_id is not null
        order by food_id, logged_at desc`);
      const sorted = [...rows].sort((a, b) => new Date(b.last_logged).getTime() - new Date(a.last_logged).getTime()).slice(0, 30);
      const map = await loadFoods(tx, sorted.map((r) => r.food_id));
      return { items: sorted.filter((r) => map.has(r.food_id)).map((r) => ({ food: map.get(r.food_id)!, lastPortion: r.portion, lastMeal: r.meal, uses: r.uses })) };
    }),
  );

  app.get("/v1/foods/favorites", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const favs = await tx.select().from(foodFavorites).where(eq(foodFavorites.userId, req.userId)).orderBy(desc(foodFavorites.createdAt));
      const map = await loadFoods(tx, favs.map((f) => f.foodId));
      return { items: favs.filter((f) => map.has(f.foodId)).map((f) => map.get(f.foodId)!) };
    }),
  );

  app.put("/v1/foods/:id/favorite", auth, async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await ctx.db.asUser(req.userId, async (tx) => {
      await loadFood(tx, id);
      await tx.insert(foodFavorites).values({ userId: req.userId, foodId: id }).onConflictDoNothing();
    });
    return reply.status(204).send();
  });

  app.delete("/v1/foods/:id/favorite", auth, async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.delete(foodFavorites).where(and(eq(foodFavorites.userId, req.userId), eq(foodFavorites.foodId, id))));
    return reply.status(204).send();
  });

  app.get("/v1/foods/:id", auth, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    return ctx.db.asUser(req.userId, (tx) => loadFood(tx, id));
  });

  /** Create a private food (manual entry or confirmed label scan). */
  app.post("/v1/foods", auth, async (req, reply) => {
    const body = parse(CustomFoodCreate, req.body);
    const barcode = body.barcode ? normalizeBarcode(body.barcode) : null;
    if (body.barcode && !barcode) throw badRequest("Barcode check digit is invalid");
    const quality = assessQuality(body.per100 as NutrientValues, body.servings.map((s) => ({ ...s, source: "label" as const })));
    const food = await ctx.db.asUser(req.userId, async (tx) => {
      const f = await createPrivateFood(tx, req.userId, { ...body, barcode, per100: body.per100 as NutrientValues, quality });
      await tx.insert(auditEvents).values({ userId: req.userId, event: "food.created", targetType: "food", targetId: f.id });
      return f;
    });
    return reply.status(201).send(food);
  });

  /**
   * Correct a food. Shared records are never modified: the correction is
   * stored as the user's private copy and preferred in their future lookups.
   * Past diary entries keep their original snapshot.
   */
  app.post("/v1/foods/:id/corrections", auth, async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        brand: z.string().trim().max(120).nullable().optional(),
        per100: NutrientValuesSchema.optional(),
        servings: z.array(z.object({ label: z.string().trim().min(1).max(60), baseAmount: z.number().positive().max(10000) })).max(20).optional(),
        reason: z.string().max(300).optional(),
      }),
      req.body,
    );
    const food = await ctx.db.asUser(req.userId, async (tx) => {
      const orig = await loadFood(tx, id);
      const per100 = { ...orig.per100, ...((body.per100 ?? {}) as NutrientValues) };
      const servings = body.servings ?? orig.servings.map((s) => ({ label: s.label, baseAmount: s.baseAmount }));
      if (orig.isPrivate) {
        await tx.update(foods).set({ name: body.name ?? orig.name, brand: body.brand !== undefined ? body.brand : orig.brand, per100, completeness: assessQuality(per100, []).completeness, updatedAt: ctx.now() }).where(eq(foods.id, id));
        if (body.servings) {
          await tx.delete(foodServings).where(eq(foodServings.foodId, id));
          if (servings.length) await tx.insert(foodServings).values(servings.map((s, i) => ({ foodId: id, ownerUserId: req.userId, label: s.label, baseAmount: s.baseAmount, source: "user", isDefault: i === 0, position: i })));
        }
        await tx.insert(auditEvents).values({ userId: req.userId, event: "food.corrected", targetType: "food", targetId: id, metadata: { reason: body.reason ?? null } });
        return loadFood(tx, id);
      }
      const copy = await createPrivateFood(tx, req.userId, {
        name: body.name ?? orig.name,
        brand: body.brand !== undefined ? body.brand : orig.brand,
        barcode: orig.barcode,
        baseUnit: orig.baseUnit,
        densityGPerMl: orig.densityGPerMl,
        per100,
        servings,
        source: "user",
        derivedFromFoodId: orig.id,
        quality: { ...assessQuality(per100, []), flags: ["user_corrected"] },
      });
      await tx.insert(auditEvents).values({ userId: req.userId, event: "food.corrected", targetType: "food", targetId: copy.id, metadata: { derivedFrom: orig.id, reason: body.reason ?? null } });
      return copy;
    });
    return reply.status(201).send(food);
  });

  /** Add a personal serving size to any visible food ("my bowl" = 320 g). */
  app.post("/v1/foods/:id/servings", auth, async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(z.object({ label: z.string().trim().min(1).max(60), baseAmount: z.number().positive().max(10000) }), req.body);
    const food = await ctx.db.asUser(req.userId, async (tx) => {
      await loadFood(tx, id);
      await tx.insert(foodServings).values({ foodId: id, ownerUserId: req.userId, label: body.label, baseAmount: body.baseAmount, source: "user", position: 100 });
      return loadFood(tx, id);
    });
    return reply.status(201).send(food);
  });
}

const COUNTRY_TAGS: Record<string, string> = { AE: "united-arab-emirates", SA: "saudi-arabia", GB: "united-kingdom", US: "united-states", FR: "france", DE: "germany", IN: "india", EG: "egypt", KW: "kuwait", QA: "qatar", OM: "oman", BH: "bahrain" };
function countryName(iso2: string): string {
  return COUNTRY_TAGS[iso2.toUpperCase()] ?? iso2.toLowerCase();
}
