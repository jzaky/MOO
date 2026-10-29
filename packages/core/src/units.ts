/**
 * Unit handling. Canonical storage units:
 *   mass   → grams (food) / kilograms (body weight, training load)
 *   volume → millilitres
 *   length → centimetres
 *   energy → kilocalories
 *
 * Original user-entered units are preserved separately by callers; these
 * helpers only convert.
 */

export type MassUnit = "mg" | "g" | "kg" | "oz" | "lb";
export type VolumeUnit = "ml" | "l" | "tsp" | "tbsp" | "cup" | "fl_oz";
export type LengthUnit = "mm" | "cm" | "m" | "in" | "ft";
export type EnergyUnit = "kcal" | "kj";
export type UnitSystem = "metric" | "imperial";

export const GRAMS_PER: Record<MassUnit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** US customary volumes (cup = 240 ml per FDA nutrition labelling rule). */
export const ML_PER: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  tsp: 5,
  tbsp: 15,
  cup: 240,
  fl_oz: 30,
};

export const CM_PER: Record<LengthUnit, number> = {
  mm: 0.1,
  cm: 1,
  m: 100,
  in: 2.54,
  ft: 30.48,
};

export const KJ_PER_KCAL = 4.184;

export function isMassUnit(u: string): u is MassUnit {
  return u in GRAMS_PER;
}

export function isVolumeUnit(u: string): u is VolumeUnit {
  return u in ML_PER;
}

export function toGrams(value: number, unit: MassUnit): number {
  return value * GRAMS_PER[unit];
}

export function fromGrams(grams: number, unit: MassUnit): number {
  return grams / GRAMS_PER[unit];
}

export function toMl(value: number, unit: VolumeUnit): number {
  return value * ML_PER[unit];
}

export function fromMl(ml: number, unit: VolumeUnit): number {
  return ml / ML_PER[unit];
}

export function toCm(value: number, unit: LengthUnit): number {
  return value * CM_PER[unit];
}

export function fromCm(cm: number, unit: LengthUnit): number {
  return cm / CM_PER[unit];
}

export function kgToLb(kg: number): number {
  return (kg * 1000) / GRAMS_PER.lb;
}

export function lbToKg(lb: number): number {
  return (lb * GRAMS_PER.lb) / 1000;
}

export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL;
}

export function kcalToKj(kcal: number): number {
  return kcal * KJ_PER_KCAL;
}

/** Round to a fixed number of decimals without floating noise (e.g. 0.1+0.2). */
export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Convert a body weight stored in kg to the user's display system. */
export function displayBodyWeight(kg: number, system: UnitSystem): { value: number; unit: "kg" | "lb" } {
  return system === "metric" ? { value: round(kg, 1), unit: "kg" } : { value: round(kgToLb(kg), 1), unit: "lb" };
}

/** Parse loosely-written unit tokens ("grams", "kilos", "lbs", "tablespoons"). */
const UNIT_ALIASES: Record<string, MassUnit | VolumeUnit> = {
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  "fl oz": "fl_oz",
  floz: "fl_oz",
  fl_oz: "fl_oz",
};

export function normalizeUnitToken(token: string): MassUnit | VolumeUnit | null {
  const t = token.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[t] ?? null;
}
