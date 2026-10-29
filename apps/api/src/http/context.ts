import type { FastifyReply, FastifyRequest } from "fastify";
import type { AiProvider } from "../ai/provider";
import type { AuthService } from "../auth/service";
import type { Config } from "../config";
import type { Database } from "../db/client";
import type { FoodSources } from "../foods/sources";
import type { MediaStorage } from "../storage/media";
import type { SpeechToText } from "../ai/speech";
import { unauthorized } from "./errors";

export interface AppContext {
  cfg: Config;
  db: Database;
  auth: AuthService;
  ai: AiProvider;
  stt: SpeechToText;
  foodSources: FoodSources;
  media: MediaStorage;
  now: () => Date;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export function makeRequireAuth(ctx: AppContext) {
  return async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const { userId } = await ctx.auth.verifyAccessToken(header.slice(7));
    req.userId = userId;
  };
}
