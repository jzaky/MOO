import type { NutrientValues } from "@moo/core";
import { assessQuality, energyKcalFrom, num, type NormalizedFood } from "./normalize";

/** External food databases. Each adapter returns NormalizedFood records. */
export interface FoodSources {
  lookupBarcode(gtin13: string): Promise<NormalizedFood | null>;
  search(query: string, opts?: { country?: string | null; limit?: number }): Promise<NormalizedFood[]>;
}

export class FoodSourceError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "FoodSourceError";
  }
}

/* ───────────── Open Food Facts ───────────── */

const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "nutriments",
  "nutrition_data_per",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "product_quantity_unit",
  "quantity",
  "image_front_url",
  "image_url",
  "countries_tags",
  "last_modified_t",
].join(",");

type OffProduct = Record<string, unknown> & { nutriments?: Record<string, unknown> };

/** Map an Open Food Facts product to our normalized model. Pure; tested with real fixtures. */
export function mapOffProduct(p: OffProduct, code: string): NormalizedFood | null {
  const n = p.nutriments ?? {};
  const name = String(p.product_name || p.product_name_en || p.generic_name || "").trim();
  if (!name) return null;
  const flags: string[] = [];
  // OFF exposes values normalized to 100 g / 100 ml in *_100g keys regardless of label basis.
  const g = (k: string) => num(n[`${k}_100g`]);
  const sodiumG = g("sodium");
  const saltG = g("salt");
  let sodiumMg: number | null = sodiumG !== null ? sodiumG * 1000 : null;
  if (sodiumMg === null && saltG !== null) {
    sodiumMg = (saltG / 2.5) * 1000;
    flags.push("sodium_from_salt");
  }
  const per100: NutrientValues = {
    energyKcal: energyKcalFrom(n["energy-kcal_100g"], n["energy-kj_100g"] ?? n["energy_100g"], flags),
    proteinG: g("proteins"),
    carbsG: g("carbohydrates"),
    fatG: g("fat"),
    fiberG: g("fiber"),
    sugarG: g("sugars"),
    addedSugarG: g("added-sugars"),
    saturatedFatG: g("saturated-fat"),
    transFatG: g("trans-fat"),
    monounsaturatedFatG: g("monounsaturated-fat"),
    polyunsaturatedFatG: g("polyunsaturated-fat"),
    cholesterolMg: g("cholesterol") !== null ? g("cholesterol")! * 1000 : null,
    sodiumMg,
    potassiumMg: g("potassium") !== null ? g("potassium")! * 1000 : null,
    calciumMg: g("calcium") !== null ? g("calcium")! * 1000 : null,
    ironMg: g("iron") !== null ? g("iron")! * 1000 : null,
    vitaminCMg: g("vitamin-c") !== null ? g("vitamin-c")! * 1000 : null,
    vitaminDUg: g("vitamin-d") !== null ? g("vitamin-d")! * 1e6 : null,
    alcoholG: g("alcohol") !== null ? (g("alcohol")! * 0.789) : null, // OFF alcohol is % vol → g/100 ml
    caffeineMg: g("caffeine") !== null ? g("caffeine")! * 1000 : null,
  };
  // Drop unknown keys entirely so absence == unknown.
  for (const k of Object.keys(per100) as (keyof NutrientValues)[]) if (per100[k] === null) delete per100[k];

  const isVolume = (u: unknown) => ["ml", "cl", "l"].includes(String(u ?? "").toLowerCase());
  // The per-100 basis follows the product quantity unit; fall back to the serving unit.
  const baseUnit: "g" | "ml" = p.product_quantity_unit ? (isVolume(p.product_quantity_unit) ? "ml" : "g") : isVolume(p.serving_quantity_unit) ? "ml" : "g";
  const servings: NormalizedFood["servings"] = [];
  const sq = num(p.serving_quantity);
  const servingUnit = p.serving_quantity_unit ? (isVolume(p.serving_quantity_unit) ? "ml" : "g") : baseUnit;
  if (sq !== null && sq > 0 && sq < 5000) {
    if (servingUnit !== baseUnit) flags.push("serving_unit_mismatch"); // e.g. serving in ml, nutrition per 100 g
    else servings.push({ label: String(p.serving_size || `${sq} ${baseUnit}`).slice(0, 60), baseAmount: sq, source: "label" });
  }
  if (Object.keys(per100).length === 0) flags.push("no_nutrition_data");
  const countries = Array.isArray(p.countries_tags) ? (p.countries_tags as unknown[]).filter((c): c is string => typeof c === "string") : [];
  return {
    source: "off",
    sourceRef: code,
    sourceLicense: "ODbL-1.0 (Open Food Facts contributors)",
    name: name.slice(0, 200),
    brand: typeof p.brands === "string" && p.brands.trim() ? p.brands.split(",")[0]!.trim().slice(0, 120) : null,
    barcode: code,
    baseUnit,
    per100,
    servings,
    imageUrl: typeof p.image_front_url === "string" ? p.image_front_url : typeof p.image_url === "string" ? p.image_url : null,
    countries,
    quality: assessQuality(per100, servings, flags),
    sourcePayload: { code, last_modified_t: p.last_modified_t ?? null, nutrition_data_per: p.nutrition_data_per ?? null },
  };
}

export class OpenFoodFactsClient {
  constructor(private readonly baseUrl: string, private readonly userAgent: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async product(code: string): Promise<NormalizedFood | null> {
    const url = `${this.baseUrl}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
    const res = await this.get(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new FoodSourceError(`Open Food Facts returned ${res.status}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { status?: number; product?: OffProduct };
    if (body.status === 0 || !body.product) return null;
    return mapOffProduct(body.product, code);
  }

  async search(query: string, country: string | null, limit: number): Promise<NormalizedFood[]> {
    const params = new URLSearchParams({ search_terms: query, search_simple: "1", action: "process", json: "1", page_size: String(limit), fields: OFF_FIELDS });
    if (country) params.set("tagtype_0", "countries"), params.set("tag_contains_0", "contains"), params.set("tag_0", country);
    const res = await this.get(`${this.baseUrl}/cgi/search.pl?${params}`);
    if (!res.ok) throw new FoodSourceError(`Open Food Facts search returned ${res.status}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { products?: OffProduct[] };
    return (body.products ?? []).map((p) => mapOffProduct(p, String(p.code ?? ""))).filter((f): f is NormalizedFood => !!f && !!f.sourceRef);
  }

  private async get(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new FoodSourceError(`Open Food Facts unreachable: ${(e as Error).message}`, true);
    }
  }
}

/* ───────────── USDA FoodData Central ───────────── */

/** FDC nutrient numbers → our keys (with unit multipliers to our units). */
const FDC_NUTRIENTS: Record<string, [keyof NutrientValues, number]> = {
  "208": ["energyKcal", 1],
  "203": ["proteinG", 1],
  "205": ["carbsG", 1],
  "204": ["fatG", 1],
  "291": ["fiberG", 1],
  "269": ["sugarG", 1],
  "539": ["addedSugarG", 1],
  "606": ["saturatedFatG", 1],
  "605": ["transFatG", 1],
  "645": ["monounsaturatedFatG", 1],
  "646": ["polyunsaturatedFatG", 1],
  "601": ["cholesterolMg", 1],
  "307": ["sodiumMg", 1],
  "306": ["potassiumMg", 1],
  "301": ["calciumMg", 1],
  "303": ["ironMg", 1],
  "304": ["magnesiumMg", 1],
  "309": ["zincMg", 1],
  "320": ["vitaminAUg", 1],
  "401": ["vitaminCMg", 1],
  "328": ["vitaminDUg", 1],
  "418": ["vitaminB12Ug", 1],
  "435": ["folateUg", 1],
  "221": ["alcoholG", 1],
  "262": ["caffeineMg", 1],
};

interface FdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodCategory?: { description?: string } | string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: { nutrientNumber?: string; number?: string; value?: number; amount?: number; nutrient?: { number?: string }; unitName?: string }[];
  foodPortions?: { gramWeight?: number; amount?: number; modifier?: string; portionDescription?: string; measureUnit?: { name?: string } }[];
}

export function mapFdcFood(f: FdcFood): NormalizedFood | null {
  if (!f.description) return null;
  const per100: NutrientValues = {};
  const flags: string[] = [];
  let atwaterKcal: number | null = null;
  for (const fn of f.foodNutrients ?? []) {
    const number = fn.nutrientNumber ?? fn.number ?? fn.nutrient?.number;
    const value = num(fn.value ?? fn.amount);
    if (!number || value === null) continue;
    if (number === "957" || number === "958") atwaterKcal ??= value; // Atwater energy (Foundation foods)
    const map = FDC_NUTRIENTS[number];
    if (map) per100[map[0]] = value * map[1];
  }
  if (per100.energyKcal === undefined && atwaterKcal !== null) {
    per100.energyKcal = atwaterKcal;
    flags.push("energy_atwater");
  }
  const servings: NormalizedFood["servings"] = [];
  const isBranded = f.dataType === "Branded";
  if (isBranded && f.servingSize && f.servingSize > 0 && /^(g|ml|grm|mlt)$/i.test(f.servingSizeUnit ?? "")) {
    servings.push({ label: (f.householdServingFullText || `${f.servingSize} ${f.servingSizeUnit}`).slice(0, 60), baseAmount: f.servingSize, source: "label" });
  }
  for (const p of f.foodPortions ?? []) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const label = [p.amount && p.amount !== 1 ? p.amount : "1", p.modifier || p.portionDescription || p.measureUnit?.name].filter(Boolean).join(" ").slice(0, 60);
    if (label && servings.length < 10) servings.push({ label, baseAmount: p.gramWeight, source: "database" });
  }
  return {
    source: "usda",
    sourceRef: String(f.fdcId),
    sourceLicense: "CC0-1.0 (USDA FoodData Central)",
    name: f.description.slice(0, 200),
    brand: f.brandName || f.brandOwner || null,
    barcode: f.gtinUpc ?? null,
    baseUnit: /^(ml|mlt)$/i.test(f.servingSizeUnit ?? "") ? "ml" : "g",
    per100,
    servings,
    imageUrl: null,
    countries: ["en:united-states"],
    quality: assessQuality(per100, servings, flags),
    sourcePayload: { fdcId: f.fdcId, dataType: f.dataType ?? null, category: typeof f.foodCategory === "string" ? f.foodCategory : f.foodCategory?.description ?? null },
  };
}

export class UsdaClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, limit: number): Promise<NormalizedFood[]> {
    const url = `${this.baseUrl}/foods/search?api_key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, pageSize: limit, dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"] }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      throw new FoodSourceError(`USDA unreachable: ${(e as Error).message}`, true);
    }
    if (!res.ok) throw new FoodSourceError(`USDA returned ${res.status}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { foods?: FdcFood[] };
    return (body.foods ?? []).map(mapFdcFood).filter((f): f is NormalizedFood => !!f);
  }
}

export class CompositeFoodSources implements FoodSources {
  constructor(private readonly off: OpenFoodFactsClient | null, private readonly usda: UsdaClient | null) {}

  async lookupBarcode(gtin13: string): Promise<NormalizedFood | null> {
    if (!this.off) return null;
    return this.off.product(gtin13);
  }

  async search(query: string, opts: { country?: string | null; limit?: number } = {}): Promise<NormalizedFood[]> {
    const limit = opts.limit ?? 15;
    const tasks: Promise<NormalizedFood[]>[] = [];
    if (this.usda) tasks.push(this.usda.search(query, limit));
    if (this.off) tasks.push(this.off.search(query, opts.country ?? null, limit));
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  }
}

/** In-memory source for tests. */
export class StaticFoodSources implements FoodSources {
  constructor(private readonly byBarcode: Record<string, NormalizedFood> = {}, private readonly searchResults: NormalizedFood[] = []) {}
  async lookupBarcode(code: string) {
    return this.byBarcode[code] ?? null;
  }
  async search(query: string) {
    const q = query.toLowerCase();
    return this.searchResults.filter((f) => f.name.toLowerCase().includes(q));
  }
}
