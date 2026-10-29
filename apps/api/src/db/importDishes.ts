import { composeDish, STANDARD_DISHES, type NutrientValues } from "@stoke/core";
import { and, eq, inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDatabase, type Db } from "./client";
import { foods } from "./schema";
import { assessQuality } from "../foods/normalize";
import { upsertSharedFood } from "../foods/repository";

/**
 * Add the UAE standard-recipe dishes to the shared catalogue, computed from
 * the USDA ingredients already imported (run import:fdc first). A dish whose
 * ingredients aren't all present is skipped, never guessed. Idempotent.
 */
export async function importStandardDishes(system: Db, now = new Date()): Promise<{ imported: string[]; skipped: { slug: string; missing: string[] }[] }> {
  const ids = [...new Set(STANDARD_DISHES.flatMap((d) => d.ingredients.map((i) => i.fdcId)))];
  const rows = await system.select({ ref: foods.sourceRef, name: foods.name, per100: foods.per100 }).from(foods).where(and(eq(foods.source, "usda"), inArray(foods.sourceRef, ids)));
  const per100 = new Map(rows.map((r) => [r.ref!, r.per100 as NutrientValues]));
  const names = new Map(rows.map((r) => [r.ref!, r.name]));
  const imported: string[] = [];
  const skipped: { slug: string; missing: string[] }[] = [];
  for (const dish of STANDARD_DISHES) {
    const c = composeDish(dish, per100);
    if (c.missing.length) {
      skipped.push({ slug: dish.slug, missing: c.missing });
      continue;
    }
    const servings = [{ label: dish.serving, baseAmount: Math.round(c.servingG), source: "database" as const }];
    await upsertSharedFood(
      system,
      {
        source: "standard_recipe",
        sourceRef: dish.slug,
        sourceLicense: "Stoke standard recipe; ingredient data USDA FoodData Central (CC0-1.0)",
        name: `${dish.name} · ${dish.nameAr}`,
        brand: null,
        barcode: null,
        baseUnit: "g",
        per100: c.per100,
        servings,
        imageUrl: null,
        countries: ["en:united-arab-emirates"],
        quality: assessQuality(c.per100, servings, ["standard_recipe", "estimate"]),
        sourcePayload: {
          slug: dish.slug,
          nameAr: dish.nameAr,
          servingG: Math.round(c.servingG),
          ingredients: dish.ingredients.map((i) => ({ fdcId: i.fdcId, label: i.label, grams: i.grams, usdaName: names.get(i.fdcId) ?? "" })),
          substitutions: dish.substitutions ?? [],
          cookedG: dish.cookedG ?? null,
        },
      },
      now,
    );
    imported.push(dish.slug);
  }
  return { imported, skipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const owner = process.env.DATABASE_OWNER_URL ?? "postgres://stoke_owner:stoke_owner@localhost:5432/stoke_dev";
  const db = createDatabase(process.env.DATABASE_URL ?? "postgres://stoke_app:stoke_app@localhost:5432/stoke_dev", owner, { max: 2 });
  importStandardDishes(db.system)
    .then((r) => {
      console.log(`standard dishes: ${r.imported.length} imported`);
      for (const s of r.skipped) console.log(`  skipped ${s.slug}: USDA ${s.missing.join(", ")} not imported (run import:fdc first)`);
    })
    .finally(() => db.close());
}
