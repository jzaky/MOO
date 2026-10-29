import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { exercises } from "../db/schema";

/**
 * Catalogue exercises (shared and the user's own, via RLS) that best match a
 * free-text name: exact alias first, then trigram similarity. Up to 3.
 */
export async function matchExercise(tx: Tx, name: string) {
  const q = name.toLowerCase().trim();
  const rows = await tx
    .select({ id: exercises.id, name: exercises.name, slug: exercises.slug })
    .from(exercises)
    .where(sql`lower(${exercises.name}) % ${q} or lower(${exercises.name}) like ${"%" + q.replace(/[%_]/g, "") + "%"} or exists (select 1 from unnest(${exercises.aliases}) a where lower(a) = ${q})`)
    .orderBy(sql`(exists (select 1 from unnest(${exercises.aliases}) a where lower(a) = ${q}))::int desc, similarity(lower(${exercises.name}), ${q}) desc`)
    .limit(3);
  return rows;
}
