import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDatabase } from "./client";
import { upsertSharedFood } from "../foods/repository";
import { mapFdcFood } from "../foods/sources";
import { importStandardDishes } from "./importDishes";

/**
 * Import a USDA FoodData Central bulk JSON file (SR Legacy or Foundation,
 * public domain / CC0) into the shared food catalogue.
 *
 *   curl -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
 *   unzip FoodData_Central_sr_legacy_food_json_2018-04.zip
 *   pnpm --filter @stoke/api import:fdc FoodData_Central_sr_legacy_food_json_2018-04.json
 *
 * Re-running is safe: records are upserted by (source, fdcId).
 */
export async function importFdcFile(file: string, ownerUrl: string, appUrl: string): Promise<{ imported: number; skipped: number }> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown[]>;
  const list = (raw.SRLegacyFoods ?? raw.FoundationFoods ?? raw.SurveyFoods ?? []) as Parameters<typeof mapFdcFood>[0][];
  const db = createDatabase(appUrl, ownerUrl, { max: 4 });
  let imported = 0;
  let skipped = 0;
  try {
    for (const item of list) {
      const n = mapFdcFood(item);
      if (!n || n.quality.completeness < 1) {
        skipped++;
        continue;
      }
      await upsertSharedFood(db.system, n, new Date());
      imported++;
      if (imported % 1000 === 0) console.log(`  ${imported} imported…`);
    }
    // Standard-recipe dishes are computed from these ingredients, so refresh them too.
    const dishes = await importStandardDishes(db.system);
    console.log(`standard dishes: ${dishes.imported.length} imported, ${dishes.skipped.length} skipped`);
  } finally {
    await db.close();
  }
  return { imported, skipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: import:fdc <FoodData_Central_*.json>");
    process.exit(1);
  }
  const owner = process.env.DATABASE_OWNER_URL ?? "postgres://stoke_owner:stoke_owner@localhost:5432/stoke_dev";
  const app = process.env.DATABASE_URL ?? "postgres://stoke_app:stoke_app@localhost:5432/stoke_dev";
  const started = Date.now();
  importFdcFile(file, owner, app)
    .then((r) => console.log(`FDC import: ${r.imported} foods imported, ${r.skipped} skipped (incomplete macros) in ${Math.round((Date.now() - started) / 1000)} s`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
