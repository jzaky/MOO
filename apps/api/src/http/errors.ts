import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError, type z } from "zod";
import { AiOutputError, AiUnavailableError } from "../ai/provider";
import { FoodSourceError } from "../foods/sources";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const unauthorized = (message = "Authentication required") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed") => new HttpError(403, "forbidden", message);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new HttpError(400, "validation_error", "Request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req: FastifyRequest, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof AiUnavailableError) {
      return reply.status(503).send({ error: { code: "ai_unavailable", message: err.message } });
    }
    if (err instanceof AiOutputError) {
      req.log.warn({ err: err.message }, "ai output rejected");
      return reply.status(502).send({ error: { code: "ai_output_invalid", message: "The AI response could not be used. Please try again or log manually." } });
    }
    if (err instanceof FoodSourceError) {
      return reply.status(err.retryable ? 503 : 502).send({ error: { code: "food_source_unavailable", message: "The food database is temporarily unavailable. Try again, or enter the food manually." } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Request validation failed", details: err.issues } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      const code = e.statusCode === 429 ? "rate_limited" : e.statusCode === 413 ? "payload_too_large" : "bad_request";
      return reply.status(e.statusCode).send({ error: { code, message: e.message ?? "Bad request" } });
    }
    // Never echo internal errors (may contain SQL or personal data).
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }));
}
