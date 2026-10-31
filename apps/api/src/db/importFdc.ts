import { createReadStream } from "node:fs";
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
/**
 * Yields each food in an FDC bulk file (`{"SRLegacyFoods": [ {...}, ... ]}`)
 * one at a time. The files are 200+ MB, so parsing them whole needs more
 * memory than a small server has; this keeps only one food in memory.
 */
export async function* streamFdcFoods(file: string): AsyncGenerator<Parameters<typeof mapFdcFood>[0]> {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts: string[] = [];
  let capturing = false;
  for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 }) as AsyncIterable<string>) {
    let start = capturing ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{" || c === "[") {
        depth++;
        // depth 1: the top-level object, 2: its food array, 3: one food.
        if (depth === 3 && c === "{") {
          capturing = true;
          start = i;
          parts = [];
        }
      } else if (c === "}" || c === "]") {
        if (depth === 3 && capturing) {
          parts.push(chunk.slice(start, i + 1));
          capturing = false;
          start = -1;
          yield JSON.parse(parts.join(""));
          parts = [];
        }
        depth--;
      }
    }
    if (capturing && start >= 0) parts.push(chunk.slice(start));
  }
}

export async function importFdcFile(file: string, ownerUrl: string, appUrl: string): Promise<{ imported: number; skipped: number }> {
  const list = streamFdcFoods(file);
  const db = createDatabase(appUrl, ownerUrl, { max: 4 });
  let imported = 0;
  let skipped = 0;
  try {
    for await (const item of list) {
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
