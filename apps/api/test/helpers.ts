import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppOverrides } from "../src/app";
import { FakeAiProvider } from "../src/ai/fake";
import { loadConfig } from "../src/config";
import { createDatabase, type Database } from "../src/db/client";
import { StaticFoodSources } from "../src/foods/sources";
import type { AppContext } from "../src/http/context";

export const TEST_APP_URL = process.env.TEST_DATABASE_URL ?? "postgres://stoke_app:stoke_app@localhost:5432/stoke_test";
export const TEST_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://stoke_owner:stoke_owner@localhost:5432/stoke_test";

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  ai: FakeAiProvider;
  db: Database;
  close(): Promise<void>;
}

export async function makeTestApp(o: AppOverrides = {}, env: Record<string, string> = {}): Promise<TestApp> {
  const storage = mkdtempSync(path.join(tmpdir(), "stoke-media-"));
  const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_APP_URL, DATABASE_OWNER_URL: TEST_OWNER_URL, STORAGE_DIR: storage, RATE_LIMIT_PER_MIN: "100000", AUTH_RATE_LIMIT_PER_MIN: "100000", ...env } as NodeJS.ProcessEnv);
  const db = createDatabase(TEST_APP_URL, TEST_OWNER_URL, { max: 5 });
  const ai = (o.ai as FakeAiProvider | undefined) ?? new FakeAiProvider();
  const { app, ctx } = await buildApp(cfg, { db, ai, foodSources: new StaticFoodSources(), logger: false, ...o });
  await app.ready();
  return { app, ctx, ai, db, close: async () => { await app.close(); await db.close(); } };
}

let counter = 0;
export async function registerUser(app: FastifyInstance, emailPrefix = "user") {
  const email = `${emailPrefix}-${Date.now()}-${counter++}@example.com`;
  const res = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, password: "correct horse battery" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { email, userId: body.user.id as string, token: body.accessToken as string, refreshToken: body.refreshToken as string, headers: { authorization: `Bearer ${body.accessToken}` } };
}

export async function onboard(app: FastifyInstance, headers: Record<string, string>, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/onboarding/complete",
    headers,
    payload: {
      sex: "male",
      birthDate: "1990-05-01",
      heightCm: 180,
      weightKg: 85,
      activityLevel: "moderate",
      goals: [{ kind: "lose_fat", priority: 1 }],
      timeZone: "Asia/Dubai",
      unitSystem: "metric",
      country: "AE",
      training: { experience: "intermediate", preferredDays: [1, 3, 5], equipment: ["barbell", "dumbbell", "cable", "machine"] },
      ...extra,
    },
  });
  if (res.statusCode !== 200) throw new Error(`onboarding failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Drizzle wraps driver errors; return the underlying Postgres message. */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message ?? String(e);
  }
  throw new Error("expected the query to fail");
}
