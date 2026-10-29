import { RecipeCreate, type PortionDto } from "@stoke/contracts";
import { computeRecipeNutrition, isVolumeUnit, sharesKeyWord, ML_PER, multiplyNutrients, normalizeUnitToken, portionToBaseAmount, type MassUnit, type NutrientValues, type ParsedFoodItem, type PortionInput, type VolumeUnit } from "@stoke/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { foods, foodServings, recipeIngredients, recipes } from "../db/schema";
import { extractRecipeFromHtml, parseIngredients } from "../foods/recipeImport";
import { createPrivateFood, loadFoods, searchLocalFoods, toNutritionBasis, type FoodDto } from "../foods/repository";
import { badRequest, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { safeFetchText } from "../util/safeFetch";

type RecipeInput = z.infer<typeof RecipeCreate>;

async function computeAndStore(tx: Tx, userId: string, body: RecipeInput, existingId?: string) {
  const foodMap = await loadFoods(tx, body.ingredients.flatMap((i) => (i.foodId ? [i.foodId] : [])));
  const matched = body.ingredients.filter((i) => i.foodId && i.portion && foodMap.has(i.foodId));
  const missing = body.ingredients.length - matched.length;
  let nutrition;
  try {
    nutrition = computeRecipeNutrition(matched.map((i) => ({ food: toNutritionBasis(foodMap.get(i.foodId!)!), portion: i.portion as PortionInput, label: i.rawText })), body.servings, body.cookedYieldG ?? null);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const yieldG = body.cookedYieldG ?? nutrition.rawWeightG;
  const per100 = yieldG > 0 ? multiplyNutrients(nutrition.total, 100 / yieldG) : {};
  const flags = [...(body.cookedYieldG ? [] : ["per100_from_raw_weight"]), ...(missing ? ["unmatched_ingredients"] : [])];

  let recipeId = existingId;
  let foodId: string;
  if (existingId) {
    const [r] = await tx.select().from(recipes).where(eq(recipes.id, existingId));
    if (!r) throw notFound("Recipe");
    if (r.foodId) {
      foodId = r.foodId;
      await tx.update(foods).set({ name: body.name, per100, completeness: 1 - missing / Math.max(1, body.ingredients.length), quality: { flags } }).where(eq(foods.id, foodId));
      await tx.delete(foodServings).where(eq(foodServings.foodId, foodId));
      await tx.insert(foodServings).values({ foodId, ownerUserId: userId, label: "1 serving", baseAmount: yieldG / body.servings, source: "user", isDefault: true });
    } else {
      foodId = (await createPrivateFood(tx, userId, { name: body.name, baseUnit: "g", per100, servings: [{ label: "1 serving", baseAmount: yieldG / body.servings }], source: "recipe", quality: { flags } })).id;
    }
    await tx.update(recipes).set({ name: body.name, servings: body.servings, cookedYieldG: body.cookedYieldG ?? null, instructions: body.instructions ?? null, sourceUrl: body.sourceUrl ?? null, meals: body.meals?.length ? body.meals : null, foodId, nutritionTotal: nutrition.total, nutritionPerServing: nutrition.perServing, missingIngredientCount: missing, updatedAt: new Date() }).where(eq(recipes.id, existingId));
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, existingId));
  } else {
    foodId = (await createPrivateFood(tx, userId, { name: body.name, baseUnit: "g", per100, servings: [{ label: "1 serving", baseAmount: yieldG / body.servings }], source: "recipe", quality: { flags } })).id;
    const [r] = await tx
      .insert(recipes)
      .values({ userId, name: body.name, servings: body.servings, cookedYieldG: body.cookedYieldG ?? null, instructions: body.instructions ?? null, sourceUrl: body.sourceUrl ?? null, meals: body.meals?.length ? body.meals : null, foodId, nutritionTotal: nutrition.total, nutritionPerServing: nutrition.perServing, missingIngredientCount: missing })
      .returning();
    recipeId = r!.id;
  }
  await tx.insert(recipeIngredients).values(
    body.ingredients.map((i, position) => {
      const f = i.foodId ? foodMap.get(i.foodId) : undefined;
      let baseAmount: number | null = null;
      if (f && i.portion) baseAmount = portionToBaseAmount(toNutritionBasis(f), i.portion as PortionInput);
      return { recipeId: recipeId!, userId, position, foodId: f ? i.foodId : null, rawText: i.rawText, portion: i.portion, baseAmount };
    }),
  );
  return getRecipe(tx, recipeId!);
}

async function getRecipe(tx: Tx, id: string) {
  const [r] = await tx.select().from(recipes).where(and(eq(recipes.id, id), isNull(recipes.deletedAt)));
  if (!r) throw notFound("Recipe");
  const ings = await tx.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).orderBy(asc(recipeIngredients.position));
  const servingRows = r.foodId ? await tx.select().from(foodServings).where(eq(foodServings.foodId, r.foodId)) : [];
  return {
    id: r.id,
    name: r.name,
    servings: r.servings,
    cookedYieldG: r.cookedYieldG,
    instructions: r.instructions,
    sourceUrl: r.sourceUrl,
    meals: r.meals ?? [],
    foodId: r.foodId,
    servingId: servingRows.find((s) => s.isDefault)?.id ?? null,
    total: r.nutritionTotal as NutrientValues,
    perServing: r.nutritionPerServing as NutrientValues,
    missingIngredientCount: r.missingIngredientCount,
    ingredients: ings.map((i) => ({ id: i.id, foodId: i.foodId, rawText: i.rawText, portion: i.portion, baseAmount: i.baseAmount })),
  };
}

/** Count and volume unit in a database serving label ("1 tablespoon", "1 cup, chopped", "1/2 cup"). */
export function servingVolume(label: string): { count: number; unit: VolumeUnit } | null {
  const m = /^\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)?\s*(fl\.?\s*oz|[a-z]+)/i.exec(label);
  if (!m) return null;
  const unit = normalizeUnitToken(m[2]!.replace(/\s+/g, " "));
  if (!unit || !isVolumeUnit(unit)) return null;
  const raw = (m[1] ?? "1").replace(",", ".").replace(/\s+/g, "");
  const count = raw.includes("/") ? Number(raw.split("/")[0]) / Number(raw.split("/")[1]) : Number(raw);
  return count > 0 && Number.isFinite(count) ? { count, unit } : null;
}

/**
 * Suggest a portion of `food` for a parsed ingredient, or null when the amount
 * cannot be expressed without guessing. Volume amounts for foods stored by
 * weight use a serving in the same unit when there is one, otherwise a density
 * derived from the food's own volume servings ("1 cup = 244 g").
 */
export function suggestPortion(item: ParsedFoodItem, food: FoodDto): PortionDto | null {
  if (typeof item.unit === "string") {
    const unit = item.unit as MassUnit | VolumeUnit;
    if (!isVolumeUnit(unit) || food.baseUnit === "ml" || food.densityGPerMl) return { kind: "amount", quantity: item.quantity, unit };
    const volumes = food.servings.map((s) => ({ s, v: servingVolume(s.label) })).filter((x): x is { s: FoodDto["servings"][number]; v: { count: number; unit: VolumeUnit } } => !!x.v && x.s.baseAmount > 0);
    const same = volumes.find((x) => x.v.unit === unit);
    if (same) return { kind: "serving", servingId: same.s.id, quantity: Math.round((item.quantity / same.v.count) * 100) / 100 };
    const ref = volumes[0];
    if (!ref) return null;
    const gPerMl = ref.s.baseAmount / (ref.v.count * ML_PER[ref.v.unit]);
    return { kind: "amount", quantity: Math.round(item.quantity * ML_PER[unit] * gPerMl * 10) / 10, unit: "g" };
  }
  const countUnit = item.unit.count;
  if (countUnit) {
    // A named unit ("slice", "clove", "pinch") must exist as a serving; otherwise ask.
    const named = food.servings.find((s) => new RegExp(`\\b${countUnit}s?\\b`, "i").test(s.label));
    return named ? { kind: "serving", servingId: named.id, quantity: item.quantity } : null;
  }
  const whole = wholeItemServing(food);
  return whole ? { kind: "serving", servingId: whole.id, quantity: item.quantity } : null;
}

/**
 * The serving that means "one of these" for a bare count ("1 onion", "2 eggs").
 * Prefers medium, then large, then small; never a slice, a cup or a spoon.
 */
export function wholeItemServing(food: FoodDto): FoodDto["servings"][number] | null {
  const partial = /\b(slices?|chopped|diced|sliced|pieces?|rings?|strips?|oz|g|grams?|cups?|tbsp|tsp|tablespoons?|teaspoons?|nlea|serving|portion|package|container|bag|can)\b/i;
  const ranked = food.servings
    .filter((s) => s.baseAmount > 0 && !servingVolume(s.label) && !partial.test(s.label))
    .map((s) => ({ s, score: /\bmedium\b/i.test(s.label) ? 3 : /\blarge\b/i.test(s.label) ? 2 : /\bsmall\b/i.test(s.label) ? 1 : s.isDefault ? 0.5 : 0 }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.s ?? null;
}

export function registerRecipeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };
  const IdParam = z.object({ id: z.uuid() });

  app.get("/v1/recipes", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(recipes).where(and(eq(recipes.userId, req.userId), isNull(recipes.deletedAt))).orderBy(asc(recipes.name));
      return { items: rows.map((r) => ({ id: r.id, name: r.name, servings: r.servings, meals: r.meals ?? [], foodId: r.foodId, perServing: r.nutritionPerServing, missingIngredientCount: r.missingIngredientCount })) };
    }),
  );

  app.get("/v1/recipes/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, (tx) => getRecipe(tx, id));
  });

  app.post("/v1/recipes", auth, async (req, reply) => {
    const body = parse(RecipeCreate, req.body);
    return reply.status(201).send(await ctx.db.asUser(req.userId, (tx) => computeAndStore(tx, req.userId, body)));
  });

  app.put("/v1/recipes/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(RecipeCreate, req.body);
    return ctx.db.asUser(req.userId, (tx) => computeAndStore(tx, req.userId, body, id));
  });

  app.delete("/v1/recipes/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.update(recipes).set({ deletedAt: ctx.now() }).where(eq(recipes.id, id)));
    return reply.status(204).send();
  });

  /**
   * Turn a recipe URL or pasted ingredient list into a DRAFT with suggested
   * food matches. Nothing is saved until the user reviews it and POSTs /v1/recipes.
   */
  app.post("/v1/recipes/draft", auth, async (req) => {
    const body = parse(z.object({ url: z.url().max(2000).optional(), text: z.string().max(20000).optional(), name: z.string().max(200).optional(), servings: z.number().positive().max(100).optional() }), req.body);
    let name = body.name ?? "Untitled recipe";
    let servings = body.servings ?? 1;
    let lines: string[] = [];
    let instructions: string[] = [];
    let sourceUrl: string | null = null;
    if (body.url) {
      const page = await safeFetchText(body.url, { userAgent: ctx.cfg.OFF_USER_AGENT });
      const r = extractRecipeFromHtml(page.text, page.url);
      if (!r) throw badRequest("No structured recipe was found on that page. Paste the ingredient list instead.");
      name = r.name;
      servings = r.servings ?? servings;
      lines = r.ingredients;
      instructions = r.instructions;
      sourceUrl = r.sourceUrl;
    } else if (body.text) {
      lines = body.text.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
    } else throw badRequest("Provide a url or text");

    return ctx.db.asUser(req.userId, async (tx) => {
      const ingredients = [];
      for (const { line, parsed } of parseIngredients(lines)) {
        if (!parsed) {
          ingredients.push({ rawText: line, parsed: null, candidates: [], suggestion: null });
          continue;
        }
        const candidates = (await searchLocalFoods(tx, req.userId, parsed.name, 3, { excludeSources: ["recipe"] })).map((f) => ({ food: f, portion: suggestPortion(parsed, f) }));
        // The best-ranked food is the suggestion even when its amount needs the user's input;
        // a different food is never substituted just because its amount converts.
        const best = candidates[0] && sharesKeyWord(parsed.name, candidates[0].food.name) ? candidates[0] : undefined;
        ingredients.push({
          rawText: line,
          parsed: { quantity: parsed.quantity, unit: parsed.unit, name: parsed.name, preparation: parsed.preparation, quantityAssumed: parsed.quantityAssumed },
          candidates,
          suggestion: best ? { foodId: best.food.id, portion: best.portion } : null,
        });
      }
      return { name, servings, sourceUrl, instructions, ingredients, note: "Review each ingredient match and amount. Nutrition is only calculated for matched ingredients." };
    });
  });
}
