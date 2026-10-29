import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../migrations");

export async function runMigrations(ownerUrl: string): Promise<void> {
  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_OWNER_URL ?? "postgres://moo_owner:moo_owner@localhost:5432/moo_dev";
  runMigrations(url)
    .then(() => console.log("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
