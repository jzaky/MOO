import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDatabase, type Db } from "./client";
import { exercises } from "./schema";
import { EXERCISES } from "./seed/exercises";

/** Upsert the original exercise catalogue into the shared (global) rows. Idempotent. */
export async function seedExercises(system: Db): Promise<number> {
  const slugs = new Set(EXERCISES.map((e) => e.slug));
  for (const e of EXERCISES) {
    for (const alt of e.alternatives ?? []) if (!slugs.has(alt)) throw new Error(`Exercise ${e.slug} references unknown alternative ${alt}`);
  }
  for (const e of EXERCISES) {
    const values = {
      ownerUserId: null,
      slug: e.slug,
      name: e.name,
      aliases: e.aliases ?? [],
      primaryMuscles: e.primary,
      secondaryMuscles: e.secondary ?? [],
      equipment: e.equipment,
      category: e.category ?? "strength",
      movementPattern: e.pattern,
      mechanics: e.mechanics ?? (e.pattern === "isolation" ? "isolation" : "compound"),
      difficulty: e.difficulty ?? "intermediate",
      loadProfile: e.load ?? "bodyweight",
      unilateral: e.unilateral ?? false,
      instructions: e.steps,
      cautions: e.cautions ?? null,
      alternatives: e.alternatives ?? [],
      license: "proprietary-original",
    };
    await system.insert(exercises).values(values).onConflictDoUpdate({ target: exercises.slug, targetWhere: sql`${exercises.ownerUserId} is null`, set: values });
  }
  return EXERCISES.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const owner = process.env.DATABASE_OWNER_URL ?? "postgres://moo_owner:moo_owner@localhost:5432/moo_dev";
  const db = createDatabase(process.env.DATABASE_URL ?? "postgres://moo_app:moo_app@localhost:5432/moo_dev", owner, { max: 2 });
  seedExercises(db.system)
    .then((n) => console.log(`seeded ${n} exercises`))
    .finally(() => db.close());
}
