import type { FastifyInstance } from "fastify";
import type { AppContext } from "../http/context";
import { registerAuthRoutes } from "./auth";
import { registerProfileRoutes } from "./profile";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerAuthRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
}
