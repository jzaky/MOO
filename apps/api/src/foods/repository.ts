import { completeness, type FoodNutritionBasis, type NutrientValues } from "@moo/core";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { foodLogs, foodServings, foods } from "../db/schema";
import { notFound } from "../http/errors";
import type { NormalizedFood } from "./normalize";

export type FoodRow = typeof foods.$inferSelect;
export type ServingRow = typeof foodServings.$inferSelect;

export interface FoodDto {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: string;
  sourceLicense: string | null;
  isPrivate: boolean;
  derivedFromFoodId: string | null;
  baseUnit: "g" | "ml";
  densityGPerMl: number | null;
  per100: NutrientValues;
  servings: { id: string; label: string; baseAmount: number; source: string; isDefault: boolean; isPrivate: boolean }[];
  completeness: number;
  quality: { flags: string[]; energyConsistent?: boolean; servingConfidence?: string };
  imageUrl: string | null;
  lastVerifiedAt: string | null;
}

export function toFoodDto(f: FoodRow, servings: ServingRow[]): FoodDto {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    barcode: f.barcode,
    source: f.source,
    sourceLicense: f.sourceLicense,
    isPrivate: f.ownerUserId !== null,
    derivedFromFoodId: f.derivedFromFoodId,
    baseUnit: f.baseUnit as "g" | "ml",
    densityGPerMl: f.densityGPerMl,
    per100: f.per100 as NutrientValues,
    servings: servings
      .filter((s) => s.foodId === f.id)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position)
      .map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount, source: s.source, isDefault: s.isDefault, isPrivate: s.ownerUserId !== null })),
    completeness: f.completeness,
    quality: (f.quality as FoodDto["quality"]) ?? { flags: [] },
    imageUrl: f.imageUrl,
    lastVerifiedAt: f.lastVerifiedAt?.toISOString() ?? null,
  };
}

export function toNutritionBasis(dto: FoodDto): FoodNutritionBasis {
  return { baseUnit: dto.baseUnit, per100: dto.per100, servings: dto.servings.map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount })), densityGPerMl: dto.densityGPerMl };
}

/** Load foods visible to the current user (RLS enforces visibility). */
export async function loadFoods(tx: Tx, ids: string[]): Promise<Map<string, FoodDto>> {
  if (!ids.length) return new Map();
  const unique = [...new Set(ids)];
  const rows = await tx.select().from(foods).where(inArray(foods.id, unique));
  const servings = rows.length ? await tx.select().from(foodServings).where(inArray(foodServings.foodId, rows.map((r) => r.id))) : [];
  return new Map(rows.map((r) => [r.id, toFoodDto(r, servings)]));
}

export async function loadFood(tx: Tx, id: string): Promise<FoodDto> {
  const f = (await loadFoods(tx, [id])).get(id);
  if (!f) throw notFound("Food");
  return f;
}

/**
 * Insert or refresh a shared catalogue record from an external source. Runs on
 * the owner connection: shared rows are not writable by the runtime role.
 */
export async function upsertSharedFood(system: Db, n: NormalizedFood, now: Date): Promise<string> {
  return system.transaction(async (tx) => {
    const values = {
      ownerUserId: null,
      source: n.source,
      sourceRef: n.sourceRef,
      sourceLicense: n.sourceLicense,
      name: n.name,
      brand: n.brand,
      barcode: n.barcode,
      baseUnit: n.baseUnit,
      per100: n.per100,
      completeness: n.quality.completeness,
      quality: n.quality,
      imageUrl: n.imageUrl,
      countries: n.countries,
      sourcePayload: n.sourcePayload,
      lastVerifiedAt: now,
      updatedAt: now,
    };
    const [existing] = await tx
      .select({ id: foods.id })
      .from(foods)
      .where(and(isNull(foods.ownerUserId), eq(foods.source, n.source), eq(foods.sourceRef, n.sourceRef)));
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.update(foods).set(values).where(eq(foods.id, id));
      await tx.delete(foodServings).where(and(eq(foodServings.foodId, id), isNull(foodServings.ownerUserId)));
    } else {
      const [row] = await tx.insert(foods).values(values).returning({ id: foods.id });
      id = row!.id;
    }
    if (n.servings.length) {
      await tx.insert(foodServings).values(n.servings.map((s, i) => ({ foodId: id, ownerUserId: null, label: s.label, baseAmount: s.baseAmount, source: s.source, isDefault: i === 0, position: i })));
    }
    return id;
  });
}

export interface CreatePrivateFood {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  baseUnit: "g" | "ml";
  densityGPerMl?: number | null;
  per100: NutrientValues;
  servings: { label: string; baseAmount: number }[];
  source: "user" | "label" | "ai_label" | "recipe";
  derivedFromFoodId?: string | null;
  quality?: object;
}

export async function createPrivateFood(tx: Tx, userId: string, input: CreatePrivateFood): Promise<FoodDto> {
  const [row] = await tx
    .insert(foods)
    .values({
      ownerUserId: userId,
      source: input.source,
      sourceRef: null,
      sourceLicense: "user-private",
      derivedFromFoodId: input.derivedFromFoodId ?? null,
      name: input.name,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      baseUnit: input.baseUnit,
      densityGPerMl: input.densityGPerMl ?? null,
      per100: input.per100,
      completeness: completeness(input.per100),
      quality: input.quality ?? { flags: [] },
    })
    .returning();
  const servings = input.servings.length
    ? await tx
        .insert(foodServings)
        .values(input.servings.map((s, i) => ({ foodId: row!.id, ownerUserId: userId, label: s.label, baseAmount: s.baseAmount, source: "user", isDefault: i === 0, position: i })))
        .returning()
    : [];
  return toFoodDto(row!, servings);
}

/**
 * Local search: user's private foods first, then shared catalogue, ranked by
 * trigram similarity (pg_trgm) plus how often the user logged the food.
 */
export async function searchLocalFoods(tx: Tx, userId: string, query: string, limit = 20, opts: { excludeSources?: string[] } = {}): Promise<FoodDto[]> {
  const q = query.trim().toLowerCase().replace(/[%_]/g, "");
  if (!q) return [];
  // Naive singular form so "eggs" also matches "egg, whole".
  const singular = q.split(/\s+/).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");
  const usage = tx
    .select({ foodId: foodLogs.foodId, uses: sql<number>`count(*)::int`.as("uses") })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), isNull(foodLogs.deletedAt)))
    .groupBy(foodLogs.foodId)
    .as("usage");
  // Word similarity tolerates typos ("chiken") against long names; 0.45 balances recall and noise.
  await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.45', true)`);
  const hay = sql`lower(${foods.name} || ' ' || coalesce(${foods.brand}, ''))`;
  const score = sql`greatest(word_similarity(${q}, ${hay}), word_similarity(${singular}, ${hay})) + case when lower(${foods.name}) like ${q + "%"} or lower(${foods.name}) like ${singular + "%"} then 0.3 else 0 end`;
  const rows = await tx
    .select({ food: foods, uses: usage.uses })
    .from(foods)
    .leftJoin(usage, eq(usage.foodId, foods.id))
    .where(
      and(
        or(sql`${q} <% ${hay}`, sql`${singular} <% ${hay}`, sql`${hay} like ${"%" + q + "%"}`),
        opts.excludeSources?.length ? sql`${foods.source} not in (${sql.join(opts.excludeSources.map((x) => sql`${x}`), sql`, `)})` : undefined,
      ),
    )
    // Relevance first, nudged by personal history: own foods and frequently logged foods rank higher.
    .orderBy(desc(sql`${score} + case when ${foods.ownerUserId} is not null then 0.15 else 0 end + least(0.3, ln(1 + coalesce(${usage.uses}, 0)) * 0.1)`), desc(foods.completeness))
    .limit(limit);
  const list = rows.map((r) => r.food);
  const servings = list.length ? await tx.select().from(foodServings).where(inArray(foodServings.foodId, list.map((f) => f.id))) : [];
  return list.map((f) => toFoodDto(f, servings));
}
