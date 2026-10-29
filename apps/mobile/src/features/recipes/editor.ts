import { computeRecipeNutrition, isKnown, type PortionInput } from "@stoke/core";
import type { PortionDto } from "@stoke/contracts";
import type { Food, Recipe, RecipeDraft } from "../../lib/types";

/**
 * Recipe editor state and the arithmetic behind its live preview. Kept free
 * of React so it can be unit-tested; the preview uses the same @stoke/core
 * function the server uses to store the recipe.
 */

export interface IngredientRow {
  key: string;
  rawText: string;
  food: Food | null;
  portion: PortionDto | null;
  /** Other foods the server suggested for this line, for one-tap swapping. */
  candidates: { food: Food; portion: PortionDto | null }[];
}

let seq = 0;
const nextKey = () => `row${++seq}`;

export function rowsFromDraft(draft: RecipeDraft): IngredientRow[] {
  return draft.ingredients.map((g) => {
    const chosen = g.suggestion ? g.candidates.find((c) => c.food.id === g.suggestion!.foodId) : undefined;
    return { key: nextKey(), rawText: g.rawText, food: chosen?.food ?? null, portion: chosen ? g.suggestion!.portion : null, candidates: g.candidates };
  });
}

export function rowsFromRecipe(recipe: Recipe, foods: Map<string, Food>): IngredientRow[] {
  return recipe.ingredients.map((g) => ({ key: nextKey(), rawText: g.rawText, food: g.foodId ? foods.get(g.foodId) ?? null : null, portion: g.portion, candidates: [] }));
}

export function rowForFood(food: Food, rawText?: string): IngredientRow {
  return { key: nextKey(), rawText: rawText ?? food.name, food, portion: { kind: "amount", quantity: 100, unit: food.baseUnit }, candidates: [] };
}

/**
 * Portion to use when the user swaps an ingredient's food. Keeps the amount if
 * the unit still applies; otherwise falls back to the server's suggestion or
 * 100 of the food's base unit. Never guesses a conversion.
 */
export function portionForSwap(food: Food, previous: PortionDto | null, suggested: PortionDto | null): PortionDto {
  if (suggested) return suggested;
  if (previous?.kind === "amount") {
    const mass = ["mg", "g", "kg", "oz", "lb"].includes(previous.unit);
    if ((food.baseUnit === "g" && mass) || (food.baseUnit === "ml" && !mass) || food.densityGPerMl) return previous;
  }
  return { kind: "amount", quantity: 100, unit: food.baseUnit };
}

export function describePortion(row: IngredientRow): string {
  const p = row.portion;
  if (!p) return "no amount";
  if (p.kind === "amount") return `${Math.round(p.quantity * 10) / 10} ${p.unit}`;
  return `${p.quantity} × ${row.food?.servings.find((s) => s.id === p.servingId)?.label ?? "serving"}`;
}

/** Set the amount. A matched food without a portion gets one in its base unit (g or ml). */
export function withQuantity(row: IngredientRow, quantity: number): IngredientRow {
  if (row.portion) return { ...row, portion: { ...row.portion, quantity } };
  return row.food ? { ...row, portion: { kind: "amount", quantity, unit: row.food.baseUnit } } : row;
}

export interface Preview {
  perServing: { energyKcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
  counted: number;
  /** Lines without a food, or whose amount cannot be converted. */
  notCounted: string[];
}

export function previewNutrition(rows: readonly IngredientRow[], servings: number, cookedYieldG: number | null): Preview | null {
  if (!(servings > 0)) return null;
  const usable: { food: Food; portion: PortionInput }[] = [];
  const notCounted: string[] = [];
  for (const r of rows) {
    if (!r.food || !r.portion || !(r.portion.quantity > 0)) {
      notCounted.push(r.rawText);
      continue;
    }
    try {
      // Validate each line on its own so one bad amount doesn't hide the rest.
      computeRecipeNutrition([{ food: basis(r.food), portion: r.portion as PortionInput }], 1);
      usable.push({ food: r.food, portion: r.portion as PortionInput });
    } catch {
      notCounted.push(r.rawText);
    }
  }
  const n = computeRecipeNutrition(usable.map((u) => ({ food: basis(u.food), portion: u.portion })), servings, cookedYieldG);
  const v = (x: number | undefined | null) => (isKnown(x) ? Math.round(x) : null);
  return { perServing: { energyKcal: v(n.perServing.energyKcal), proteinG: v(n.perServing.proteinG), carbsG: v(n.perServing.carbsG), fatG: v(n.perServing.fatG) }, counted: usable.length, notCounted };
}

function basis(f: Food) {
  return { baseUnit: f.baseUnit, per100: f.per100, servings: f.servings.map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount })), densityGPerMl: f.densityGPerMl };
}

export function toRecipeBody(args: { name: string; servings: number; cookedYieldG: number | null; instructions: string; sourceUrl: string | null; meals?: readonly string[]; rows: readonly IngredientRow[] }) {
  return {
    name: args.name.trim(),
    servings: args.servings,
    cookedYieldG: args.cookedYieldG,
    instructions: args.instructions.trim() || null,
    sourceUrl: args.sourceUrl,
    meals: [...(args.meals ?? [])],
    ingredients: args.rows.map((r) => ({ foodId: r.food && r.portion ? r.food.id : null, rawText: r.rawText.slice(0, 300), portion: r.food ? r.portion : null })),
  };
}
