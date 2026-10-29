import { RecipeCreate, type PortionDto } from "@moo/contracts";
import { computeRecipeNutrition, multiplyNutrients, portionToBaseAmount, type NutrientValues, type ParsedFoodItem, type PortionInput } from "@moo/core";
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
    await tx.update(recipes).set({ name: body.name, servings: body.servings, cookedYieldG: body.cookedYieldG ?? null, instructions: body.instructions ?? null, sourceUrl: body.sourceUrl ?? null, foodId, nutritionTotal: nutrition.total, nutritionPerServing: nutrition.perServing, missingIngredientCount: missing, updatedAt: new Date() }).where(eq(recipes.id, existingId));
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, existingId));
  } else {
    foodId = (await createPrivateFood(tx, userId, { name: body.name, baseUnit: "g", per100, servings: [{ label: "1 serving", baseAmount: yieldG / body.servings }], source: "recipe", quality: { flags } })).id;
    const [r] = await tx
      .insert(recipes)
      .values({ userId, name: body.name, servings: body.servings, cookedYieldG: body.cookedYieldG ?? null, instructions: body.instructions ?? null, sourceUrl: body.sourceUrl ?? null, foodId, nutritionTotal: nutrition.total, nutritionPerServing: nutrition.perServing, missingIngredientCount: missing })
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
    foodId: r.foodId,
    servingId: servingRows.find((s) => s.isDefault)?.id ?? null,
    total: r.nutritionTotal as NutrientValues,
    perServing: r.nutritionPerServing as NutrientValues,
    missingIngredientCount: r.missingIngredientCount,
    ingredients: ings.map((i) => ({ id: i.id, foodId: i.foodId, rawText: i.rawText, portion: i.portion, baseAmount: i.baseAmount })),
  };
}

/** Suggest a portion for a parsed ingredient against a candidate food. */
export function suggestPortion(item: ParsedFoodItem, food: FoodDto): PortionDto | null {
  if (typeof item.unit === "string") {
    const isVol = ["ml", "l", "tsp", "tbsp", "cup", "fl_oz"].includes(item.unit);
    if (isVol && food.baseUnit === "g" && !food.densityGPerMl) {
      const serving = food.servings.find((s) => s.label.toLowerCase().includes(item.unit as string));
      return serving ? { kind: "serving", servingId: serving.id, quantity: item.quantity } : null;
    }
    return { kind: "amount", quantity: item.quantity, unit: item.unit as Extract<PortionDto, { kind: "amount" }>["unit"] };
  }
  const countUnit = item.unit.count;
  const serving = (countUnit && food.servings.find((s) => s.label.toLowerCase().includes(countUnit))) || food.servings[0];
  return serving ? { kind: "serving", servingId: serving.id, quantity: item.quantity } : null;
}

export function registerRecipeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };
  const IdParam = z.object({ id: z.uuid() });

  app.get("/v1/recipes", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(recipes).where(and(eq(recipes.userId, req.userId), isNull(recipes.deletedAt))).orderBy(asc(recipes.name));
      return { items: rows.map((r) => ({ id: r.id, name: r.name, servings: r.servings, foodId: r.foodId, perServing: r.nutritionPerServing, missingIngredientCount: r.missingIngredientCount })) };
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
        const best = candidates.find((c) => c.portion);
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
