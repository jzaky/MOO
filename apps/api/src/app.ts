import cors from "@fastify/cors";
import { registerWebApp } from "./http/web";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { AnthropicProvider } from "./ai/anthropic";
import { FakeAiProvider } from "./ai/fake";
import { DisabledAiProvider, type AiProvider } from "./ai/provider";
import { DisabledSpeechToText, WhisperCppSpeechToText, type SpeechToText } from "./ai/speech";
import { AuthService } from "./auth/service";
import type { Config } from "./config";
import { createDatabase, type Database } from "./db/client";
import { CompositeFoodSources, OpenFoodFactsClient, UsdaClient, type FoodSources } from "./foods/sources";
import type { AppContext } from "./http/context";
import { registerErrorHandler } from "./http/errors";
import { registerRoutes } from "./routes";
import { LocalMediaStorage, type MediaStorage } from "./storage/media";

export interface AppOverrides {
  db?: Database;
  ai?: AiProvider;
  stt?: SpeechToText;
  foodSources?: FoodSources;
  media?: MediaStorage;
  now?: () => Date;
  logger?: boolean;
}

export function createContext(cfg: Config, o: AppOverrides = {}): AppContext {
  const db = o.db ?? createDatabase(cfg.DATABASE_URL, cfg.DATABASE_OWNER_URL);
  const now = o.now ?? (() => new Date());
  let ai: AiProvider = o.ai ?? new DisabledAiProvider();
  if (!o.ai) {
    if (cfg.AI_PROVIDER === "anthropic") {
      // A key can be added later: until then AI features answer "not configured" and everything else runs.
      if (cfg.ANTHROPIC_API_KEY?.trim()) ai = new AnthropicProvider(cfg.ANTHROPIC_API_KEY.trim(), cfg.AI_MODEL);
      else console.warn("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty: AI features are off until a key is set.");
    } else if (cfg.AI_PROVIDER === "fake") ai = new FakeAiProvider();
  }
  return {
    cfg,
    db,
    now,
    auth: new AuthService(db, cfg),
    ai,
    stt: o.stt ?? (cfg.STT_URL ? new WhisperCppSpeechToText(cfg.STT_URL) : new DisabledSpeechToText()),
    foodSources:
      o.foodSources ??
      new CompositeFoodSources(new OpenFoodFactsClient(cfg.OFF_BASE_URL, cfg.OFF_USER_AGENT), cfg.USDA_API_KEY ? new UsdaClient(cfg.USDA_BASE_URL, cfg.USDA_API_KEY) : null),
    media: o.media ?? new LocalMediaStorage(cfg.STORAGE_DIR, cfg.MEDIA_SIGNING_SECRET, cfg.PUBLIC_BASE_URL, now),
  };
}

export async function buildApp(cfg: Config, o: AppOverrides = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const ctx = createContext(cfg, o);
  const app = Fastify({
    logger:
      o.logger === false
        ? false
        : {
            level: cfg.NODE_ENV === "production" ? "info" : "debug",
            // Never log bodies or auth headers: they contain health data and credentials.
            redact: ["req.headers.authorization", "req.headers.cookie", "req.body", "res.body"],
          },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });
  registerErrorHandler(app);
  await app.register(helmet, { contentSecurityPolicy: false });
  // Native apps are not subject to CORS; this serves the web build. The plugin's
  // default (GET, HEAD, POST) would block the PUT upserts and DELETEs.
  await app.register(cors, { origin: cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean), methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], credentials: false });
  await app.register(rateLimit, { max: cfg.RATE_LIMIT_PER_MIN, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 4 } });
  app.get("/health", async () => ({ ok: true }));
  registerRoutes(app, ctx);
  if (cfg.WEB_DIR) registerWebApp(app, cfg.WEB_DIR);
  app.addHook("onClose", async () => {
    if (!o.db) await ctx.db.close();
  });
  return { app, ctx };
}
