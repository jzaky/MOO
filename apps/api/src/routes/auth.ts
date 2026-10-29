import { LoginRequest, RefreshRequest, RegisterRequest } from "@stoke/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "../http/errors";
import type { AppContext } from "../http/context";
import { makeRequireAuth } from "../http/context";

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireAuth = makeRequireAuth(ctx);
  const strict = { config: { rateLimit: { max: ctx.cfg.AUTH_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } };

  app.post("/v1/auth/register", strict, async (req, reply) => {
    const body = parse(RegisterRequest, req.body);
    const tokens = await ctx.auth.register(body.email, body.password, req.headers["user-agent"]);
    return reply.status(201).send(tokens);
  });

  app.post("/v1/auth/login", strict, async (req) => {
    const body = parse(LoginRequest, req.body);
    return ctx.auth.login(body.email, body.password, req.headers["user-agent"]);
  });

  app.post("/v1/auth/refresh", strict, async (req) => {
    const body = parse(RefreshRequest, req.body);
    return ctx.auth.refresh(body.refreshToken, req.headers["user-agent"]);
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const body = parse(RefreshRequest, req.body);
    await ctx.auth.logout(body.refreshToken);
    return reply.status(204).send();
  });

  app.get("/v1/me", { preHandler: requireAuth }, async (req) => {
    const user = await ctx.auth.getUser(req.userId);
    return { user };
  });

  app.delete("/v1/me", { preHandler: requireAuth, ...strict }, async (req, reply) => {
    const body = parse(z.object({ password: z.string().min(1), confirm: z.literal("DELETE") }), req.body);
    // Stored media is removed after the password check and before the rows disappear.
    await ctx.auth.deleteAccount(req.userId, body.password, () => ctx.media.deleteAllForUser(req.userId));
    return reply.status(204).send();
  });
}
