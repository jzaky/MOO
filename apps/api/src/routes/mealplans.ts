import { addDays, buildGroceryList, isKnown, scalePer100, type IngredientNeed, type NutrientValues } from "@stoke/core";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { foods, groceryItems, groceryLists, mealPlanItems, mealPlans, pantryItems, recipeIngredients, recipes, savedMeals } from "../db/schema";
import { loadFoods } from "../foods/repository";
import { badRequest, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { currentTargets } from "./profile";

const MEAL_SHARE: Record<string, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snacks: 0.1 };

interface Candidate {
  kind: "recipe" | "saved_meal";
  id: string;
  name: string;
  perUnit: { energyKcal: number; proteinG: number };
  meals: string[] | null;
  scales: number[];
}

async function candidates(tx: Tx, userId: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const r of await tx.select().from(recipes).where(and(eq(recipes.userId, userId), isNull(recipes.deletedAt)))) {
    const ps = r.nutritionPerServing as NutrientValues;
    if (!isKnown(ps.energyKcal) || ps.energyKcal <= 0) continue;
    out.push({ kind: "recipe", id: r.id, name: r.name, perUnit: { energyKcal: ps.energyKcal, proteinG: isKnown(ps.proteinG) ? ps.proteinG : 0 }, meals: null, scales: [0.5, 1, 1.5, 2] });
  }
  const sms = await tx.select().from(savedMeals).where(and(eq(savedMeals.userId, userId), isNull(savedMeals.deletedAt)));
  const fm = await loadFoods(tx, sms.flatMap((m) => (m.items as { foodId: string }[]).map((i) => i.foodId)));
  for (const m of sms) {
    let e = 0, p = 0, ok = true;
    for (const i of m.items as { foodId: string; portion: { kind: string; quantity: number; servingId?: string } }[]) {
      const f = fm.get(i.foodId);
      if (!f) { ok = false; break; }
      const base = i.portion.kind === "serving" ? (f.servings.find((s) => s.id === i.portion.servingId)?.baseAmount ?? 0) * i.portion.quantity : i.portion.quantity;
      const n = scalePer100(f.per100, base);
      e += isKnown(n.energyKcal) ? n.energyKcal : 0;
      p += isKnown(n.proteinG) ? n.proteinG : 0;
    }
    if (ok && e > 0) out.push({ kind: "saved_meal", id: m.id, name: m.name, perUnit: { energyKcal: e, proteinG: p }, meals: m.defaultMeal ? [m.defaultMeal] : null, scales: [1] });
  }
  return out;
}

/**
 * Deterministic plan: per meal, pick the candidate/scale closest to that meal's
 * energy share. Repeats are discouraged within a day (the same dish at two
 * meals) and at the same meal on consecutive days.
 */
export function assemblePlan(cands: readonly Candidate[], targetKcal: number, targetProtein: number, days: string[], meals: string[]) {
  const items: { day: string; meal: string; candidate: Candidate; scale: number; energyKcal: number; proteinG: number }[] = [];
  const lastUse = new Map<string, number>();
  days.forEach((day, di) => {
    const usedToday = new Set<string>();
    for (const meal of meals) {
      const goalE = targetKcal * (MEAL_SHARE[meal] ?? 0.25);
      const goalP = targetProtein * (MEAL_SHARE[meal] ?? 0.25);
      let best: { c: Candidate; s: number; score: number } | null = null;
      for (const c of cands) {
        if (c.meals && !c.meals.includes(meal)) continue;
        for (const s of c.scales) {
          const e = c.perUnit.energyKcal * s, p = c.perUnit.proteinG * s;
          const used = lastUse.get(`${c.id}:${meal}`);
          const repeatPenalty = (used !== undefined && di - used < 2 ? 0.5 : 0) + (usedToday.has(c.id) ? 0.6 : 0);
          const score = Math.abs(e - goalE) / goalE + Math.max(0, goalP - p) / Math.max(goalP, 1) * 0.5 + repeatPenalty;
          if (!best || score < best.score) best = { c, s, score };
        }
      }
      if (best && best.score < 1.5) {
        items.push({ day, meal, candidate: best.c, scale: best.s, energyKcal: Math.round(best.c.perUnit.energyKcal * best.s), proteinG: Math.round(best.c.perUnit.proteinG * best.s) });
        lastUse.set(`${best.c.id}:${meal}`, di);
        usedToday.add(best.c.id);
      }
    }
  });
  return items;
}

function nutritionFor(u: Candidate["perUnit"] | undefined, servings: number) {
  return { energyKcal: u ? Math.round(u.energyKcal * servings) : null, proteinG: u ? Math.round(u.proteinG * servings) : null };
}

async function loadPlan(tx: Tx, id: string) {
  const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, id));
  if (!p) throw notFound("Meal plan");
  // Current per-serving values of the planned recipes and meals (null if one was since removed).
  const perUnit = new Map((await candidates(tx, p.userId)).map((c) => [c.id, c.perUnit]));
  const items = await tx.select().from(mealPlanItems).where(eq(mealPlanItems.planId, id)).orderBy(asc(mealPlanItems.day));
  const rec = items.some((i) => i.recipeId) ? await tx.select().from(recipes).where(inArray(recipes.id, items.flatMap((i) => (i.recipeId ? [i.recipeId] : [])))) : [];
  const sm = items.some((i) => i.savedMealId) ? await tx.select().from(savedMeals).where(inArray(savedMeals.id, items.flatMap((i) => (i.savedMealId ? [i.savedMealId] : [])))) : [];
  return {
    id: p.id,
    startDay: p.startDay,
    days: p.days,
    status: p.status,
    items: items.map((i) => ({ id: i.id, day: i.day, meal: i.meal, recipeId: i.recipeId, savedMealId: i.savedMealId, servings: i.servings, name: rec.find((r) => r.id === i.recipeId)?.name ?? sm.find((s) => s.id === i.savedMealId)?.name ?? "(removed)", notes: i.notes, ...nutritionFor(perUnit.get(i.recipeId ?? i.savedMealId ?? ""), i.servings) })),
  };
}

export function registerMealPlanRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };
  const IdParam = z.object({ id: z.uuid() });

  app.post("/v1/meal-plans/generate", auth, async (req, reply) => {
    const body = parse(z.object({ startDay: z.iso.date(), days: z.number().int().min(1).max(14).default(7), meals: z.array(z.enum(["breakfast", "lunch", "dinner", "snacks"])).min(1).max(4).default(["breakfast", "lunch", "dinner"]) }), req.body);
    const plan = await ctx.db.asUser(req.userId, async (tx) => {
      const t = await currentTargets(tx, req.userId, body.startDay);
      if (!t) throw badRequest("Set nutrition targets first");
      const cands = await candidates(tx, req.userId);
      if (!cands.length) throw badRequest("Save a few recipes or meals first; plans are built from your own meals so the nutrition values are known.");
      const days = Array.from({ length: body.days }, (_, i) => addDays(body.startDay, i));
      const items = assemblePlan(cands, t.energyKcal, t.proteinG, days, body.meals);
      const [p] = await tx.insert(mealPlans).values({ userId: req.userId, startDay: body.startDay, days: body.days, createdBy: "engine" }).returning();
      if (items.length) {
        await tx.insert(mealPlanItems).values(items.map((i) => ({ userId: req.userId, planId: p!.id, day: i.day, meal: i.meal, recipeId: i.candidate.kind === "recipe" ? i.candidate.id : null, savedMealId: i.candidate.kind === "saved_meal" ? i.candidate.id : null, servings: i.scale })));
      }
      const perDay = days.map((d) => {
        const di = items.filter((i) => i.day === d);
        return { day: d, energyKcal: di.reduce((a, i) => a + i.energyKcal, 0), proteinG: di.reduce((a, i) => a + i.proteinG, 0), mealsPlanned: di.length };
      });
      return { ...(await loadPlan(tx, p!.id)), perDay, targets: { energyKcal: t.energyKcal, proteinG: t.proteinG }, note: "Built from your saved recipes and meals. Snacks or small additions may be needed to reach targets exactly." };
    });
    return reply.status(201).send(plan);
  });

  app.get("/v1/meal-plans", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => ({ items: await Promise.all((await tx.select().from(mealPlans).where(eq(mealPlans.userId, req.userId)).orderBy(desc(mealPlans.createdAt)).limit(10)).map((p) => loadPlan(tx, p.id))) })),
  );

  app.get("/v1/meal-plans/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, (tx) => loadPlan(tx, id));
  });

  app.delete("/v1/meal-plans/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.delete(mealPlans).where(eq(mealPlans.id, id)));
    return reply.status(204).send();
  });

  /** Consolidated grocery list for a plan, minus pantry stock, grouped by category. */
  app.post("/v1/meal-plans/:id/grocery-list", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const list = await ctx.db.asUser(req.userId, async (tx) => {
      const plan = await loadPlan(tx, id);
      const needs: { foodId: string; amount: number; recipe: string }[] = [];
      for (const it of plan.items) {
        if (it.recipeId) {
          const [r] = await tx.select().from(recipes).where(eq(recipes.id, it.recipeId));
          if (!r) continue;
          const ings = await tx.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id));
          for (const g of ings) if (g.foodId && g.baseAmount) needs.push({ foodId: g.foodId, amount: (g.baseAmount * it.servings) / r.servings, recipe: r.name });
        } else if (it.savedMealId) {
          const [m] = await tx.select().from(savedMeals).where(eq(savedMeals.id, it.savedMealId));
          const fm = await loadFoods(tx, ((m?.items ?? []) as { foodId: string }[]).map((i) => i.foodId));
          for (const i of (m?.items ?? []) as { foodId: string; portion: { kind: string; quantity: number; servingId?: string } }[]) {
            const f = fm.get(i.foodId);
            if (!f) continue;
            const base = i.portion.kind === "serving" ? (f.servings.find((s) => s.id === i.portion.servingId)?.baseAmount ?? 0) * i.portion.quantity : i.portion.quantity;
            needs.push({ foodId: f.id, amount: base * it.servings, recipe: m!.name });
          }
        }
      }
      const fmap = needs.length ? await tx.select().from(foods).where(inArray(foods.id, [...new Set(needs.map((n) => n.foodId))])) : [];
      // Drinking water (tap or bottled) is not a grocery item.
      const byId = new Map(fmap.filter((f) => f.source !== "recipe" && !/^water\b/i.test(f.name)).map((f) => [f.id, f]));
      const ingredientNeeds: IngredientNeed[] = needs.filter((n) => byId.has(n.foodId)).map((n) => {
        const f = byId.get(n.foodId)!;
        const category = ((f.sourcePayload as { category?: string } | null)?.category as string | undefined) ?? "Other";
        return { key: f.id, name: f.name, quantity: n.amount, unit: f.baseUnit, category, sourceRecipe: n.recipe };
      });
      const pantry = await tx.select().from(pantryItems).where(eq(pantryItems.userId, req.userId));
      const lines = buildGroceryList(ingredientNeeds, pantry.map((p) => ({ key: p.key, quantity: p.quantity, unit: p.unit })));
      const [gl] = await tx.insert(groceryLists).values({ userId: req.userId, mealPlanId: id, name: `Groceries for ${plan.startDay}` }).returning();
      if (lines.length) await tx.insert(groceryItems).values(lines.map((l, i) => ({ userId: req.userId, listId: gl!.id, key: l.key, name: l.name, quantity: Math.round(l.quantity), unit: l.unit, category: l.category, position: i })));
      return { id: gl!.id, name: gl!.name, items: await tx.select().from(groceryItems).where(eq(groceryItems.listId, gl!.id)).orderBy(asc(groceryItems.position)) };
    });
    return reply.status(201).send(list);
  });

  app.get("/v1/grocery-lists/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [gl] = await tx.select().from(groceryLists).where(eq(groceryLists.id, id));
      if (!gl) throw notFound("Grocery list");
      return { id: gl.id, name: gl.name, items: await tx.select().from(groceryItems).where(eq(groceryItems.listId, id)).orderBy(asc(groceryItems.position)) };
    });
  });

  app.patch("/v1/grocery-items/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(z.object({ checked: z.boolean() }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [row] = await tx.update(groceryItems).set({ checked: body.checked }).where(eq(groceryItems.id, id)).returning();
      if (!row) throw notFound("Grocery item");
      return row;
    });
  });

  app.get("/v1/pantry", auth, async (req) => ctx.db.asUser(req.userId, async (tx) => ({ items: await tx.select().from(pantryItems).where(eq(pantryItems.userId, req.userId)).orderBy(asc(pantryItems.name)) })));

  app.put("/v1/pantry", auth, async (req) => {
    const body = parse(z.object({ key: z.string().min(1).max(80), name: z.string().min(1).max(120), quantity: z.number().min(0).max(100000), unit: z.string().min(1).max(20) }), req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const [row] = await tx
        .insert(pantryItems)
        .values({ userId: req.userId, ...body })
        .onConflictDoUpdate({ target: [pantryItems.userId, pantryItems.key, pantryItems.unit], set: { name: body.name, quantity: body.quantity, updatedAt: ctx.now() } })
        .returning();
      return row;
    });
  });

  app.delete("/v1/pantry/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.delete(pantryItems).where(eq(pantryItems.id, id)));
    return reply.status(204).send();
  });
}
