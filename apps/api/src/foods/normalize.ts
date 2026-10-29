import { checkEnergyConsistency, completeness, isKnown, kjToKcal, type NutrientValues } from "@moo/core";

/**
 * Normalized food record produced by every source adapter, before it is
 * stored. Values are per 100 of `baseUnit`; missing nutrients are absent
 * (never 0).
 */
export interface NormalizedFood {
  source: "off" | "usda" | "user" | "label" | "ai_label";
  sourceRef: string;
  sourceLicense: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  baseUnit: "g" | "ml";
  per100: NutrientValues;
  servings: { label: string; baseAmount: number; source: "label" | "database" }[];
  imageUrl: string | null;
  countries: string[];
  quality: FoodQuality;
  sourcePayload: unknown;
}

export interface FoodQuality {
  completeness: number;
  flags: string[];
  energyConsistent: boolean;
  servingConfidence: "label" | "database" | "none";
}

export function assessQuality(per100: NutrientValues, servings: NormalizedFood["servings"], extraFlags: string[] = []): FoodQuality {
  const flags = [...extraFlags];
  const cons = checkEnergyConsistency(per100);
  if (!cons.ok) flags.push("energy_macro_mismatch");
  const c = completeness(per100);
  if (c < 1) flags.push("missing_macros");
  for (const [k, v] of Object.entries(per100)) {
    if (isKnown(v) && v < 0) flags.push(`negative_${k}`);
  }
  const macroMass = ["proteinG", "carbsG", "fatG", "fiberG"].reduce((a, k) => a + (isKnown(per100[k as keyof NutrientValues]) ? (per100[k as keyof NutrientValues] as number) : 0), 0);
  if (macroMass > 105) flags.push("macros_exceed_100g");
  if (isKnown(per100.energyKcal) && per100.energyKcal > 900) flags.push("energy_exceeds_900kcal");
  return {
    completeness: c,
    flags,
    energyConsistent: cons.ok,
    servingConfidence: servings.some((s) => s.source === "label") ? "label" : servings.length ? "database" : "none",
  };
}

/** Prefer stated kcal; fall back to kJ conversion (flagged). */
export function energyKcalFrom(kcal: unknown, kj: unknown, flags: string[]): number | null {
  const k = num(kcal);
  if (k !== null) return k;
  const j = num(kj);
  if (j !== null) {
    flags.push("energy_from_kj");
    return Math.round(kjToKcal(j) * 10) / 10;
  }
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) return Number(v);
  return null;
}

/** Validate an EAN-8/UPC-A/EAN-13/GTIN-14 check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Normalize a scanned code to GTIN-13 where possible. iOS reports UPC-A as a
 * 13-digit EAN with a leading 0; some scanners return 12-digit UPC-A.
 */
export function normalizeBarcode(raw: string): string | null {
  const code = raw.replace(/\D/g, "");
  if (code.length === 12) return isValidGtin(code) ? `0${code}` : null;
  if (code.length === 14 && code.startsWith("0")) return isValidGtin(code) ? code.slice(1) : null;
  return isValidGtin(code) ? code : null;
}
