import { MeasurementUpsert } from "@moo/contracts";
import { addDays, clampClientTimestamp, dayKeyInZone, estimateRate, ewmaTrend, goalProgress, sevenDayAverage } from "@moo/core";
import type { MultipartFile } from "@fastify/multipart";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import type { Tx } from "../db/client";
import { auditEvents, bodyMeasurements, goals, progressPhotos } from "../db/schema";
import { badRequest, conflict, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { isUniqueViolation } from "../util/ids";
import { getProfile } from "./profile";

export async function weightSeries(tx: Tx, userId: string, from?: string, to?: string) {
  const rows = await tx
    .select({ day: bodyMeasurements.day, value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, "weight"), isNull(bodyMeasurements.deletedAt), from ? gte(bodyMeasurements.day, from) : undefined, to ? lte(bodyMeasurements.day, to) : undefined))
    .orderBy(asc(bodyMeasurements.day));
  return rows.map((r) => ({ day: r.day, kg: r.value }));
}

export async function weightOverview(tx: Tx, userId: string, today: string) {
  const all = await weightSeries(tx, userId);
  const trend = ewmaTrend(all);
  const rate = estimateRate(all, today);
  const [goal] = await tx.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"))).orderBy(asc(goals.priority)).limit(1);
  const startKg = all[0]?.kg ?? null;
  const progress = goal?.targetWeightKg && startKg != null && rate.latestTrendKg != null ? goalProgress(startKg, rate.latestTrendKg, goal.targetWeightKg, rate.kgPerWeek) : null;
  return {
    latest: all.at(-1) ?? null,
    sevenDayAverageKg: sevenDayAverage(all, today),
    trend: trend.slice(-180),
    rate,
    goal: goal ? { kind: goal.kind, targetWeightKg: goal.targetWeightKg, weeklyRatePct: goal.weeklyRatePct } : null,
    progress,
    interpretation:
      rate.sufficiency === "insufficient"
        ? "Not enough weigh-ins yet to estimate a trend. Daily readings fluctuate with water and food; the trend becomes meaningful after about two weeks."
        : rate.sufficiency === "limited"
          ? "Early estimate: the trend may still shift as more weigh-ins arrive."
          : "Trend based on at least three weeks of data. Single-day changes are mostly water and food volume.",
  };
}

export function registerProgressRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };
  const IdParam = z.object({ id: z.uuid() });

  app.put("/v1/measurements/:id", auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(MeasurementUpsert, req.body);
    if (body.kind === "weight" && (body.value < 25 || body.value > 350)) throw badRequest("Body weight must be between 25 and 350 kg");
    if (body.kind === "body_fat_pct" && body.value > 75) throw badRequest("Body fat percentage looks implausible");
    return ctx.db.asUser(req.userId, async (tx) => {
      const ts = new Date(clampClientTimestamp(body.clientUpdatedAt, ctx.now()));
      const [existing] = await tx.select().from(bodyMeasurements).where(eq(bodyMeasurements.id, id));
      if (existing && existing.clientUpdatedAt >= ts) return { id, applied: false };
      const values = { day: body.day, measuredAt: new Date(body.measuredAt), kind: body.kind, value: body.value, originalValue: body.originalValue ?? null, originalUnit: body.originalUnit ?? null, note: body.note ?? null, clientUpdatedAt: ts, deletedAt: null, updatedAt: ctx.now() };
      try {
        if (existing) await tx.update(bodyMeasurements).set({ ...values, version: existing.version + 1 }).where(eq(bodyMeasurements.id, id));
        else await tx.insert(bodyMeasurements).values({ id, userId: req.userId, source: "manual", ...values });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict("This entry id is already in use");
        throw e;
      }
      return { id, applied: true };
    });
  });

  app.delete("/v1/measurements/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await ctx.db.asUser(req.userId, (tx) => tx.update(bodyMeasurements).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(bodyMeasurements.id, id)));
    return reply.status(204).send();
  });

  app.get("/v1/measurements", auth, async (req) => {
    const q = parse(z.object({ kind: z.string().max(50).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, req.userId), isNull(bodyMeasurements.deletedAt), q.kind ? eq(bodyMeasurements.kind, q.kind) : undefined, q.from ? gte(bodyMeasurements.day, q.from) : undefined, q.to ? lte(bodyMeasurements.day, q.to) : undefined))
        .orderBy(desc(bodyMeasurements.measuredAt))
        .limit(1000);
      return { items: rows.map((r) => ({ id: r.id, day: r.day, measuredAt: r.measuredAt.toISOString(), kind: r.kind, value: r.value, originalValue: r.originalValue, originalUnit: r.originalUnit, source: r.source, note: r.note })) };
    });
  });

  app.get("/v1/progress/weight", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      return weightOverview(tx, req.userId, dayKeyInZone(ctx.now(), p.timeZone));
    }),
  );

  /** Change in each circumference between the first and latest reading in a window. */
  app.get("/v1/progress/measurements-summary", auth, async (req) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(7).max(3650).default(90) }), req.query);
    return ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const rows = await tx.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.userId, req.userId), isNull(bodyMeasurements.deletedAt), gte(bodyMeasurements.day, addDays(today, -q.days)))).orderBy(asc(bodyMeasurements.day));
      const byKind = new Map<string, { day: string; value: number }[]>();
      for (const r of rows) {
        if (r.kind === "weight") continue;
        const arr = byKind.get(r.kind) ?? [];
        arr.push({ day: r.day, value: r.value });
        byKind.set(r.kind, arr);
      }
      return { items: [...byKind.entries()].map(([kind, pts]) => ({ kind, first: pts[0], latest: pts.at(-1), change: pts.length > 1 ? pts.at(-1)!.value - pts[0]!.value : null, points: pts })) };
    });
  });

  /* ── Progress photos (private; served only via short-lived signed URLs) ── */

  app.post("/v1/progress-photos", auth, async (req, reply) => {
    if (!req.isMultipart()) throw badRequest("Expected multipart/form-data");
    let file: Buffer | null = null;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const f = part as MultipartFile;
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.mimetype)) throw badRequest("Unsupported image type");
        file = await f.toBuffer();
      } else fields[part.fieldname] = String((part as { value: unknown }).value ?? "");
    }
    if (!file) throw badRequest("Attach a photo");
    const meta = parse(z.object({ day: z.iso.date(), view: z.enum(["front", "side", "back", "custom"]) }), fields);
    // Re-encode: normalizes orientation and strips EXIF/GPS metadata.
    const img = sharp(file, { failOn: "error" }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
    const jpeg = await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    const info = await sharp(jpeg).metadata();
    const key = await ctx.media.put(req.userId, "progress", jpeg, "image/jpeg");
    const row = await ctx.db.asUser(req.userId, async (tx) => {
      const [r] = await tx.insert(progressPhotos).values({ userId: req.userId, day: meta.day, view: meta.view, storageKey: key, width: info.width ?? null, height: info.height ?? null, bytes: jpeg.byteLength }).returning();
      await tx.insert(auditEvents).values({ userId: req.userId, event: "progress_photo.uploaded", targetType: "progress_photo", targetId: r!.id });
      return r!;
    });
    return reply.status(201).send({ id: row.id, day: row.day, view: row.view, url: ctx.media.signedUrl(key), width: row.width, height: row.height });
  });

  app.get("/v1/progress-photos", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const rows = await tx.select().from(progressPhotos).where(and(eq(progressPhotos.userId, req.userId), isNull(progressPhotos.deletedAt))).orderBy(desc(progressPhotos.day), asc(progressPhotos.view));
      return { items: rows.map((r) => ({ id: r.id, day: r.day, view: r.view, width: r.width, height: r.height, url: ctx.media.signedUrl(r.storageKey) })) };
    }),
  );

  app.delete("/v1/progress-photos/:id", auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const key = await ctx.db.asUser(req.userId, async (tx) => {
      const [r] = await tx.select().from(progressPhotos).where(eq(progressPhotos.id, id));
      if (!r) throw notFound("Photo");
      await tx.delete(progressPhotos).where(eq(progressPhotos.id, id));
      await tx.insert(auditEvents).values({ userId: req.userId, event: "progress_photo.deleted", targetType: "progress_photo", targetId: id });
      return r.storageKey;
    });
    await ctx.media.delete(key);
    return reply.status(204).send();
  });

  /** Signed media access. The signature is the capability; it expires after a few minutes. */
  app.get("/v1/media/*", async (req, reply) => {
    const key = decodeURIComponent((req.params as { "*": string })["*"]);
    const q = parse(z.object({ expires: z.coerce.number().int(), sig: z.string().min(10).max(200) }), req.query);
    if (!ctx.media.verify(key, q.expires, q.sig)) return reply.status(403).send({ error: { code: "forbidden", message: "Link expired or invalid" } });
    const obj = await ctx.media.get(key);
    if (!obj) throw notFound("Media");
    return reply.header("Content-Type", obj.contentType).header("Cache-Control", "private, max-age=300").header("X-Content-Type-Options", "nosniff").send(obj.data);
  });
}
