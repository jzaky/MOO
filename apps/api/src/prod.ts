import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { runMigrations } from "./db/migrate";
import { seedExercises } from "./db/seed";
import { createDatabase } from "./db/client";

/**
 * Production entry point for a hosted database (Render, Neon, Supabase, Fly…).
 *
 * Only DATABASE_OWNER_URL (the provider's admin connection) and APP_DB_PASSWORD
 * are required. On every start it:
 *   1. creates the RLS roles if missing: stoke_runtime, and a login role
 *      (APP_DB_USER, default stoke_app) that the API uses at runtime;
 *   2. derives DATABASE_URL from the owner URL with that login, unless set;
 *   3. applies migrations and the exercise catalogue (both idempotent);
 *   4. starts the API, then, if the USDA catalogue is missing, downloads and
 *      imports it in the background (about a minute; the UAE dishes follow).
 *      Set FOOD_CATALOGUE_AUTO_IMPORT=0 to skip.
 */

const FDC_ZIP = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip";
const run = promisify(execFile);

const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is required (the database's admin connection string)");
const appUser = process.env.APP_DB_USER ?? "stoke_app";
const appPassword = process.env.APP_DB_PASSWORD;
if (!process.env.DATABASE_URL && !appPassword) throw new Error("Set APP_DB_PASSWORD (or DATABASE_URL for an existing runtime role)");
if (!/^[a-z_][a-z0-9_]*$/.test(appUser)) throw new Error("APP_DB_USER must be a plain lower-case identifier");

export function runtimeUrl(owner: string, user: string, password: string): string {
  const u = new URL(owner);
  u.username = user;
  u.password = password;
  return u.toString();
}

async function ensureRoles(): Promise<void> {
  const sql = postgres(ownerUrl!, { max: 1, onnotice: () => {} });
  try {
    await sql`do $$ begin if not exists (select from pg_roles where rolname = 'stoke_runtime') then create role stoke_runtime nologin; end if; end $$`;
    if (appPassword) {
      const exists = (await sql`select 1 from pg_roles where rolname = ${appUser}`).length > 0;
      // Role names can't be bound parameters; the name is validated above and the password is escaped as a literal.
      const pw = `'${appPassword.replace(/'/g, "''")}'`;
      await sql.unsafe(exists ? `alter role ${appUser} with login password ${pw}` : `create role ${appUser} login password ${pw}`);
      await sql.unsafe(`grant stoke_runtime to ${appUser}`);
    }
  } catch (e) {
    throw new Error(`Could not create database roles (${(e as Error).message}). The owner connection needs permission to CREATE ROLE; on a provider without it, create stoke_runtime and a login role that is a member of it by hand and set DATABASE_URL.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function importUsdaIfMissing(appUrl: string): Promise<void> {
  const sql = postgres(ownerUrl!, { max: 1, onnotice: () => {} });
  const [{ n }] = (await sql`select count(*)::int as n from foods where source = 'usda'`) as unknown as [{ n: number }];
  await sql.end({ timeout: 5 });
  if (n > 0) return;
  const dir = await mkdtemp(path.join(tmpdir(), "fdc-"));
  try {
    console.log("food catalogue: downloading USDA SR Legacy (CC0)…");
    const res = await fetch(FDC_ZIP);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    await writeFile(path.join(dir, "fdc.zip"), Buffer.from(await res.arrayBuffer()));
    await run("unzip", ["-o", "-q", path.join(dir, "fdc.zip"), "-d", dir]);
    const json = (await readdir(dir)).find((f) => f.endsWith(".json"));
    if (!json) throw new Error("no JSON file in the USDA archive");
    // A separate process: if the import ever fails, the website and API stay up.
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "db", "importFdc.ts");
    const { stdout } = await run(process.execPath, ["--import", "tsx", script, path.join(dir, json)], {
      env: { ...process.env, DATABASE_OWNER_URL: ownerUrl!, DATABASE_URL: appUrl },
      maxBuffer: 16 * 1024 * 1024,
    });
    console.log(stdout.trim().split("\n").filter((l) => !l.includes("imported…")).map((l) => `food catalogue: ${l}`).join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await ensureRoles();
const appUrl = process.env.DATABASE_URL ?? runtimeUrl(ownerUrl, appUser, appPassword!);
await runMigrations(ownerUrl);
const seedDb = createDatabase(appUrl, ownerUrl, { max: 2 });
try {
  console.log(`exercise catalogue: ${await seedExercises(seedDb.system)} exercises`);
} finally {
  await seedDb.close();
}

// Hosts like Render expose the public URL themselves; signed media links need it.
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
const cfg = loadConfig({ ...process.env, DATABASE_URL: appUrl, DATABASE_OWNER_URL: ownerUrl, ...(publicBaseUrl ? { PUBLIC_BASE_URL: publicBaseUrl } : {}) });
const { app } = await buildApp(cfg);
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
await app.listen({ port: cfg.PORT, host: cfg.HOST });

if (process.env.FOOD_CATALOGUE_AUTO_IMPORT !== "0") {
  importUsdaIfMissing(appUrl).catch((e: Error) => console.error(`food catalogue import failed: ${e.message}`));
}
