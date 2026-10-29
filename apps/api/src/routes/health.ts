import { CheckinUpsert, HealthIngestRequest } from "@moo/contracts";
import { addDays, dayKeyInZone, mean } from "@moo/core";
import { and, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bodyMeasurements, dailyCheckins, healthObservations } from "../db/schema";
import { badRequest, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { dailyTotalsBySource, recoverySnapshot } from "../services/recovery";
import { getProfile } from "./profile";

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx) };

  /**
   * Batch ingest from HealthKit / Health Connect. Deduplicated on
   * (user, provider, sourceRecordId) so re-syncing the same samples is a no-op.
   * Body-mass samples also become weight measurements (source-tagged).
   */
  app.post("/v1/health/observations", auth, async (req) => {
    const body = parse(HealthIngestRequest, req.body);
    return ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      let inserted = 0;
      let weights = 0;
      for (const o of body.observations) {
        const start = new Date(o.startAt);
        const end = new Date(o.endAt);
        if (end < start) throw badRequest(`Observation ${o.sourceRecordId} ends before it starts`);
        if (o.type === "body_mass_kg" && (o.value < 25 || o.value > 350)) continue;
        // Attribute sleep to the day the user woke up; everything else to the start day.
        const day = dayKeyInZone(o.type === "sleep_minutes" ? end : start, p.timeZone);
        const res = await tx
          .insert(healthObservations)
          .values({ userId: req.userId, provider: body.provider, sourceRecordId: o.sourceRecordId, type: o.type, day, startAt: start, endAt: end, value: o.value, sourceName: o.sourceName ?? null })
          .onConflictDoNothing({ target: [healthObservations.userId, healthObservations.provider, healthObservations.sourceRecordId] })
          .returning({ id: healthObservations.id });
        if (res.length) inserted++;
        if (o.type === "body_mass_kg") {
          const w = await tx
            .insert(bodyMeasurements)
            .values({ id: crypto.randomUUID(), userId: req.userId, day, measuredAt: start, kind: "weight", value: o.value, source: body.provider, sourceRecordId: o.sourceRecordId, clientUpdatedAt: ctx.now() })
            .onConflictDoNothing()
            .returning({ id: bodyMeasurements.id });
          if (w.length) weights++;
        }
      }
      return { received: body.observations.length, inserted, duplicates: body.observations.length - inserted, weightsAdded: weights };
    });
  });

  app.put("/v1/checkins/:day", auth, async (req) => {
    const { day } = parse(z.object({ day: z.iso.date() }), req.params);
    const body = parse(CheckinUpsert, req.body);
    await ctx.db.asUser(req.userId, (tx) =>
      tx
        .insert(dailyCheckins)
        .values({ userId: req.userId, day, ...body })
        .onConflictDoUpdate({ target: [dailyCheckins.userId, dailyCheckins.day], set: { ...body, updatedAt: ctx.now() } }),
    );
    return { day, ...body };
  });

  /** Recovery dashboard: signals vs personal baseline, plus plain-language insights. No composite score. */
  app.get("/v1/recovery/summary", auth, async (req) =>
    ctx.db.asUser(req.userId, async (tx) => {
      const p = await getProfile(tx, req.userId);
      const today = dayKeyInZone(ctx.now(), p.timeZone);
      const snap = await recoverySnapshot(tx, req.userId, today);
      const last7 = snap.signals.filter((s) => s.day > addDays(today, -7));
      const base = snap.signals.filter((s) => s.day <= addDays(today, -7));
      const avg = (xs: typeof snap.signals, k: "sleepMinutes" | "restingHr" | "trainingLoad") => mean(xs.map((x) => x[k]).filter((v): v is number => typeof v === "number"));
      const steps = [...(await dailyTotalsBySource(tx, req.userId, "steps", addDays(today, -13), today))].map(([day, total]) => ({ day, steps: total }));
      return {
        day: today,
        readiness: snap.readiness,
        insights: snap.insights,
        sleep: { last7AvgMin: avg(last7, "sleepMinutes"), baselineAvgMin: avg(base, "sleepMinutes") },
        restingHr: { last7Avg: avg(last7, "restingHr"), baselineAvg: avg(base, "restingHr") },
        trainingLoad: { last7: last7.reduce((a, s) => a + (s.trainingLoad ?? 0), 0), weeklyBaseline: base.length ? base.reduce((a, s) => a + (s.trainingLoad ?? 0), 0) / Math.max(1, base.length / 7) : null },
        steps: steps.map((s) => ({ day: s.day, steps: Math.round(Number(s.steps)) })).sort((a, b) => (a.day < b.day ? -1 : 1)),
        signals: snap.signals.slice(-14),
        explanation: "Each signal is compared with your own recent average. There is no single recovery score: the inputs are shown so you can judge them.",
      };
    }),
  );
}
