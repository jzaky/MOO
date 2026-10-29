import { parseIngredientLine } from "@moo/core";

/**
 * Extract a schema.org Recipe from HTML JSON-LD. Clean-room implementation
 * of the approach used by recipe scrapers' schema.org fallback (see
 * docs/research/03-recipes-and-movement.md); no third-party code is copied.
 */

export interface ImportedRecipe {
  name: string;
  servings: number | null;
  ingredients: string[];
  instructions: string[];
  sourceUrl: string;
  image: string | null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== "object") return false;
  const t = (node as Record<string, unknown>)["@type"];
  return asArray(t as string | string[]).some((x) => typeof x === "string" && x.toLowerCase() === "recipe");
}

function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  if (isRecipe(node)) return node as Record<string, unknown>;
  const o = node as Record<string, unknown>;
  return findRecipe(o["@graph"], depth + 1) ?? findRecipe(o["mainEntity"], depth + 1);
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&frac12;/g, "½")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function parseYield(v: unknown): number | null {
  for (const item of asArray(v as unknown)) {
    const m = String(item).match(/\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (n > 0 && n <= 100) return n;
    }
  }
  return null;
}

function parseInstructions(v: unknown): string[] {
  const out: string[] = [];
  for (const step of asArray(v as unknown)) {
    if (typeof step === "string") out.push(...step.split(/\n+/).map(decode).filter(Boolean));
    else if (step && typeof step === "object") {
      const o = step as Record<string, unknown>;
      if (o["@type"] === "HowToSection") out.push(...parseInstructions(o["itemListElement"]));
      else if (typeof o["text"] === "string") out.push(decode(o["text"]));
    }
  }
  return out.slice(0, 100);
}

export function extractRecipeFromHtml(html: string, sourceUrl: string): ImportedRecipe | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  for (const raw of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const r = findRecipe(parsed);
    if (!r) continue;
    const name = decode(String(r["name"] ?? "")).slice(0, 200);
    const ingredients = asArray(r["recipeIngredient"] as string[] | undefined).map((s) => decode(String(s))).filter(Boolean).slice(0, 100);
    if (!name || !ingredients.length) continue;
    const img = asArray(r["image"] as unknown)[0];
    return {
      name,
      servings: parseYield(r["recipeYield"]),
      ingredients,
      instructions: parseInstructions(r["recipeInstructions"]),
      sourceUrl,
      image: typeof img === "string" ? img : img && typeof img === "object" && typeof (img as Record<string, unknown>)["url"] === "string" ? ((img as Record<string, unknown>)["url"] as string) : null,
    };
  }
  return null;
}

export function parseIngredients(lines: string[]) {
  return lines.map((line) => ({ line, parsed: parseIngredientLine(line) }));
}
