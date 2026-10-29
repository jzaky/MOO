import { isMassUnit, isVolumeUnit, toGrams, toMl, type MassUnit, type VolumeUnit } from "../units";

/**
 * Grocery list consolidation: merges the same ingredient across recipes,
 * converting compatible units (mass↔mass, volume↔volume), deducting pantry
 * stock, and grouping by aisle category.
 */

export interface IngredientNeed {
  /** Stable key for the ingredient (food id or normalized name). */
  key: string;
  name: string;
  quantity: number;
  unit: MassUnit | VolumeUnit | string;
  category?: string;
  sourceRecipe?: string;
}

export interface PantryItem {
  key: string;
  quantity: number;
  unit: MassUnit | VolumeUnit | string;
}

export interface GroceryLine {
  key: string;
  name: string;
  quantity: number;
  /** "g" | "ml" for convertible units, otherwise the original count unit. */
  unit: string;
  category: string;
  sources: string[];
}

type Dim = { dim: "mass" | "volume" | "count"; amount: number; unit: string };

function toDim(q: number, unit: string): Dim {
  if (isMassUnit(unit)) return { dim: "mass", amount: toGrams(q, unit), unit: "g" };
  if (isVolumeUnit(unit)) return { dim: "volume", amount: toMl(q, unit), unit: "ml" };
  return { dim: "count", amount: q, unit };
}

export function buildGroceryList(needs: readonly IngredientNeed[], pantry: readonly PantryItem[] = []): GroceryLine[] {
  const lines = new Map<string, GroceryLine>();
  for (const n of needs) {
    if (!(n.quantity > 0)) continue;
    const d = toDim(n.quantity, n.unit);
    const id = `${n.key}|${d.dim}|${d.dim === "count" ? d.unit : ""}`;
    const line = lines.get(id) ?? { key: n.key, name: n.name, quantity: 0, unit: d.unit, category: n.category ?? "Other", sources: [] };
    line.quantity += d.amount;
    if (n.sourceRecipe && !line.sources.includes(n.sourceRecipe)) line.sources.push(n.sourceRecipe);
    lines.set(id, line);
  }
  for (const p of pantry) {
    const d = toDim(p.quantity, p.unit);
    const id = `${p.key}|${d.dim}|${d.dim === "count" ? d.unit : ""}`;
    const line = lines.get(id);
    if (line) line.quantity = Math.max(0, line.quantity - d.amount);
  }
  return [...lines.values()]
    .filter((l) => l.quantity > 1e-9)
    .map((l) => ({ ...l, quantity: Math.round(l.quantity * 100) / 100 }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
