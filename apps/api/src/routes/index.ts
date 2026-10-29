import type { FastifyInstance } from "fastify";
import type { AppContext } from "../http/context";
import { registerAiRoutes } from "./ai";
import { registerAuthRoutes } from "./auth";
import { registerDiaryRoutes } from "./diary";
import { registerFoodRoutes } from "./foods";
import { registerProfileRoutes } from "./profile";
import { registerRecipeRoutes } from "./recipes";
import { registerTrainingRoutes } from "./training";
import { registerProgressRoutes } from "./progress";
import { registerHealthRoutes } from "./health";
import { registerCoachRoutes } from "./coach";
import { registerMealPlanRoutes } from "./mealplans";
import { registerPlatformRoutes } from "./platform";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerAuthRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerFoodRoutes(app, ctx);
  registerDiaryRoutes(app, ctx);
  registerRecipeRoutes(app, ctx);
  registerAiRoutes(app, ctx);
  registerTrainingRoutes(app, ctx);
  registerProgressRoutes(app, ctx);
  registerHealthRoutes(app, ctx);
  registerCoachRoutes(app, ctx);
  registerMealPlanRoutes(app, ctx);
  registerPlatformRoutes(app, ctx);
}
