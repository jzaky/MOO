import type { FastifyInstance } from "fastify";
import type { AppContext } from "../http/context";
import { registerAiRoutes } from "./ai";
import { registerAuthRoutes } from "./auth";
import { registerDiaryRoutes } from "./diary";
import { registerFoodRoutes } from "./foods";
import { registerProfileRoutes } from "./profile";
import { registerRecipeRoutes } from "./recipes";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerAuthRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerFoodRoutes(app, ctx);
  registerDiaryRoutes(app, ctx);
  registerRecipeRoutes(app, ctx);
  registerAiRoutes(app, ctx);
}
