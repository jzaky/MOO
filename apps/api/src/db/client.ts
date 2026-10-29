import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  /** Runtime pool. Never query it directly: use `asUser`. */
  app: Db;
  /** Owner pool for auth and shared-catalogue maintenance. Bypasses RLS. */
  system: Db;
  /**
   * Run `fn` in a transaction with `app.user_id` set, so Row-Level Security
   * limits every statement to this user's rows.
   */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(appUrl: string, ownerUrl: string, opts: { max?: number } = {}): Database {
  const appClient = postgres(appUrl, { max: opts.max ?? 10, onnotice: () => {} });
  const ownerClient = postgres(ownerUrl, { max: Math.max(2, Math.floor((opts.max ?? 10) / 3)), onnotice: () => {} });
  const app = drizzle(appClient, { schema });
  const system = drizzle(ownerClient, { schema });
  return {
    app,
    system,
    async asUser(userId, fn) {
      return app.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
        return fn(tx);
      });
    },
    async close() {
      await Promise.all([appClient.end({ timeout: 5 }), ownerClient.end({ timeout: 5 })]);
    },
  };
}
