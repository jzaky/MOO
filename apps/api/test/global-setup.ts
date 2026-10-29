import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { runMigrations } from "../src/db/migrate";
import { seedExercises } from "../src/db/seed";
import * as schema from "../src/db/schema";

export const TEST_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://moo_owner:moo_owner@localhost:5432/moo_test";

/** Recreate the test schema from migrations, exactly as production would apply them. */
export default async function setup() {
  const sql = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  await runMigrations(TEST_OWNER_URL);
  const seedClient = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  await seedExercises(drizzle(seedClient, { schema }));
  await seedClient.end();
}
