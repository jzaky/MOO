import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "postgres://moo_owner:moo_owner@localhost:5432/moo_dev" },
});
