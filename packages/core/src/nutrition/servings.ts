import { isMassUnit, isVolumeUnit, toGrams, toMl, type MassUnit, type VolumeUnit } from "../units";
import { scalePer100, type NutrientValues } from "./nutrients";

/**
 * Foods store nutrients per 100 of their base unit: 100 g for solids, 100 ml
 * for liquids. A serving is a named amount of the base unit ("1 slice" = 28 g).
 */
export type BaseUnit = "g" | "ml";

export interface ServingDef {
  id: string;
  label: string;
  /** Amount of the base unit one serving represents. */
  baseAmount: number;
  /** Whether the serving size came from the label/database or was estimated. */
  source?: "label" | "database" | "user" | "estimated";
}

export interface FoodNutritionBasis {
  baseUnit: BaseUnit;
  per100: NutrientValues;
  servings: readonly ServingDef[];
  /** Grams per millilitre, when known. Enables g↔ml conversion. */
  densityGPerMl?: number | null;
}

export type PortionInput =
  | { kind: "serving"; servingId: string; quantity: number }
  | { kind: "amount"; quantity: number; unit: MassUnit | VolumeUnit };

export class PortionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortionError";
  }
}

/** Convert a portion to an amount of the food's base unit. */
export function portionToBaseAmount(food: FoodNutritionBasis, portion: PortionInput): number {
  if (!(portion.quantity > 0) || !Number.isFinite(portion.quantity)) {
    throw new PortionError("Quantity must be a positive number");
  }
  if (portion.kind === "serving") {
    const serving = food.servings.find((s) => s.id === portion.servingId);
    if (!serving) throw new PortionError(`Unknown serving ${portion.servingId}`);
    return serving.baseAmount * portion.quantity;
  }
  const { unit, quantity } = portion;
  if (food.baseUnit === "g") {
    if (isMassUnit(unit)) return toGrams(quantity, unit);
    if (isVolumeUnit(unit)) {
      if (!food.densityGPerMl) throw new PortionError("This food has no density; enter a weight instead of a volume");
      return toMl(quantity, unit) * food.densityGPerMl;
    }
  } else {
    if (isVolumeUnit(unit)) return toMl(quantity, unit);
    if (isMassUnit(unit)) {
      if (!food.densityGPerMl) throw new PortionError("This food has no density; enter a volume instead of a weight");
      return toGrams(quantity, unit) / food.densityGPerMl;
    }
  }
  throw new PortionError(`Unsupported unit ${String(unit)}`);
}

export function nutrientsForPortion(food: FoodNutritionBasis, portion: PortionInput): { baseAmount: number; nutrients: NutrientValues } {
  const baseAmount = portionToBaseAmount(food, portion);
  return { baseAmount, nutrients: scalePer100(food.per100, baseAmount) };
}

/**
 * Convert label values given per serving into per-100 base values. Used when a
 * label only lists per-serving nutrition.
 */
export function perServingToPer100(perServing: NutrientValues, servingBaseAmount: number): NutrientValues {
  if (!(servingBaseAmount > 0)) throw new PortionError("Serving size must be positive");
  return scalePer100(perServing, (100 / servingBaseAmount) * 100);
}
