import { multiplyNutrients, sumNutrients, totalsToValues, type NutrientTotals, type NutrientValues } from "./nutrients";
import { nutrientsForPortion, type FoodNutritionBasis, type PortionInput } from "./servings";

/**
 * Recipe nutrition = Σ ingredient nutrition. Per-serving values divide by the
 * number of servings; per-gram values use the cooked yield weight when known
 * (cooking changes water content, so raw ingredient weight is NOT the yield).
 */

export interface RecipeIngredientInput {
  food: FoodNutritionBasis;
  portion: PortionInput;
  /** Free-text ingredient line as entered, for display. */
  label?: string;
}

export interface RecipeNutrition {
  totals: NutrientTotals;
  total: NutrientValues;
  perServing: NutrientValues;
  /** Per 100 g of cooked dish; null when yield weight is unknown. */
  per100gCooked: NutrientValues | null;
  rawWeightG: number;
  servings: number;
}

export function computeRecipeNutrition(ingredients: readonly RecipeIngredientInput[], servings: number, cookedYieldG?: number | null): RecipeNutrition {
  if (!(servings > 0)) throw new RangeError("Servings must be positive");
  const parts: NutrientValues[] = [];
  let rawWeightG = 0;
  for (const ing of ingredients) {
    const { baseAmount, nutrients } = nutrientsForPortion(ing.food, ing.portion);
    parts.push(nutrients);
    rawWeightG += ing.food.baseUnit === "g" ? baseAmount : baseAmount * (ing.food.densityGPerMl ?? 1);
  }
  const totals = sumNutrients(parts);
  const total = totalsToValues(totals);
  const perServing = multiplyNutrients(total, 1 / servings);
  const per100gCooked = cookedYieldG && cookedYieldG > 0 ? multiplyNutrients(total, 100 / cookedYieldG) : null;
  return { totals, total, perServing, per100gCooked, rawWeightG, servings };
}

/** Scale ingredient quantities to a new number of servings. */
export function scaleRecipe<T extends { portion: PortionInput }>(ingredients: readonly T[], fromServings: number, toServings: number): T[] {
  if (!(fromServings > 0) || !(toServings > 0)) throw new RangeError("Servings must be positive");
  const f = toServings / fromServings;
  return ingredients.map((ing) => ({ ...ing, portion: { ...ing.portion, quantity: ing.portion.quantity * f } }));
}
