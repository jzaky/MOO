import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  /** Runtime connection: a role that is a member of stoke_runtime (RLS applies). */
  DATABASE_URL: z.string().default("postgres://stoke_app:stoke_app@localhost:5432/stoke_dev"),
  /** Owner connection: migrations and named system tasks only. */
  DATABASE_OWNER_URL: z.string().default("postgres://stoke_owner:stoke_owner@localhost:5432/stoke_dev"),
  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret"),
  MEDIA_SIGNING_SECRET: z.string().min(32).default("dev-only-media-secret-change-me-0123456789"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),
  STORAGE_DIR: z.string().default("./storage"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().default("http://localhost:8081,http://localhost:19006"),
  /** AI provider. "none" disables AI features with a clear error. */
  AI_PROVIDER: z.enum(["anthropic", "none", "fake"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  /** Open Food Facts requires an identifying User-Agent. */
  OFF_USER_AGENT: z.string().default("StokeFitness/0.1 (private development build)"),
  OFF_BASE_URL: z.string().default("https://world.openfoodfacts.org"),
  USDA_API_KEY: z.string().optional(),
  USDA_BASE_URL: z.string().default("https://api.nal.usda.gov/fdc/v1"),
  /** Optional speech-to-text server (e.g. whisper.cpp server) for voice logging. */
  STT_URL: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(240),
  /** Stricter per-IP limit for credential endpoints. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(10),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = Env.parse(env);
  if (cfg.NODE_ENV === "production") {
    if (cfg.JWT_SECRET.startsWith("dev-only") || cfg.MEDIA_SIGNING_SECRET.startsWith("dev-only")) {
      throw new Error("Refusing to start in production with development secrets");
    }
  }
  return cfg;
}
