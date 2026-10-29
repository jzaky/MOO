import { completeness, rankFoods, SEARCH_DESCRIPTORS, stem, words, type FoodNutritionBasis, type NutrientValues } from "@moo/core";
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

/** How many candidates the database hands to the ranker. */
const CANDIDATES = 300;

/**
 * Local search over the user's private foods and the shared catalogue.
 * Postgres finds candidates (word prefixes and pg_trgm similarity); the
 * ranking itself lives in @moo/core so it can be unit-tested.
 */
export async function searchLocalFoods(tx: Tx, userId: string, query: string, limit = 20, opts: { excludeSources?: string[] } = {}): Promise<FoodDto[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const likeQ = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const usage = tx
    .select({ foodId: foodLogs.foodId, uses: sql<number>`count(*)::int`.as("uses") })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), isNull(foodLogs.deletedAt)))
    .groupBy(foodLogs.foodId)
    .as("usage");
  // Word similarity tolerates typos ("chiken") against long names; 0.45 balances recall and noise.
  await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.45', true)`);
  const hay = sql`lower(${foods.name} || ' ' || coalesce(${foods.brand}, ''))`;
  // Candidate retrieval: names containing a query word (as a word prefix, plural or
  // singular) or close by trigram. Descriptive words ("raw", "cooked") alone would
  // match thousands of foods, so they only count when nothing else is typed.
  const all = [...new Set(words(q).filter((w) => w.length >= 2))].slice(0, 6);
  const keyWords = all.filter((w) => !SEARCH_DESCRIPTORS.has(w));
  const retrieval = (keyWords.length ? keyWords : all).flatMap((w) => [w, stem(w)]);
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = retrieval.length ? `\\m(${[...new Set(retrieval)].map(escape).join("|")})` : null;
  const hits = retrieval.length ? sql`(${sql.join([...new Set(keyWords.length ? keyWords : all)].map((w) => sql`case when ${hay} ~ ${"\\m(" + escape(w) + "|" + escape(stem(w)) + ")"} then 1 else 0 end`), sql` + `)})` : sql`0`;
  const similarity = sql<number>`word_similarity(${q}, ${hay})`;
  const rows = await tx
    .select({ food: foods, uses: usage.uses, similarity })
    .from(foods)
    .leftJoin(usage, eq(usage.foodId, foods.id))
    .where(
      and(
        or(sql`${q} <% ${hay}`, sql`${hay} like ${"%" + likeQ + "%"}`, pattern ? sql`${hay} ~ ${pattern}` : undefined),
        opts.excludeSources?.length ? sql`${foods.source} not in (${sql.join(opts.excludeSources.map((x) => sql`${x}`), sql`, `)})` : undefined,
      ),
    )
    .orderBy(desc(hits), desc(sql`${foods.ownerUserId} is not null`), desc(sql`coalesce(${usage.uses}, 0)`), desc(similarity), sql`length(${foods.name})`)
    .limit(CANDIDATES);
  // Final order: relevance rules from @moo/core (head food, extra words, processed forms, history).
  const ranked = rankFoods(
    q,
    rows.map((r) => ({ name: r.food.name, brand: r.food.brand, isPrivate: r.food.ownerUserId != null, uses: Number(r.uses ?? 0), completeness: r.food.completeness ?? 0, similarity: Number(r.similarity), row: r })),
  ).slice(0, limit);
  const list = ranked.map((r) => r.row.food);
  const servings = list.length ? await tx.select().from(foodServings).where(inArray(foodServings.foodId, list.map((f) => f.id))) : [];
  return list.map((f) => toFoodDto(f, servings));
}
