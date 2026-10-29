import { acceptsExerciseMatch, exerciseQueries, ImportFormatError, localTimeToUtc, parseImport, type ImportedWorkout, type ParsedImport } from "@stoke/core";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Tx } from "../db/client";
import { auditEvents, bodyMeasurements, diaryDays, exercises } from "../db/schema";
import { badRequest, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { matchExercise } from "../services/exerciseMatch";
import { deterministicUuid } from "../util/ids";
import { upsertFoodLog } from "./diary";
import { getProfile } from "./profile";
import { upsertWorkout } from "./training";

/**
 * Import history from Strong, Hevy and MyFitnessPal exports.
 *
 * Preview parses and matches without writing anything. Commit writes with
 * ids derived from (user, source, record), so importing the same file twice
 * adds nothing the second time, and workouts are processed oldest first so
 * personal records and progression are computed against real history.
 */

const SOURCES = ["strong", "hevy", "mfp_nutrition", "mfp_measurements"] as const;
const ImportRequest = z.object({
  text: z.string().min(1).max(20_000_000),
  source: z.enum(SOURCES).optional(),
  weightUnit: z.enum(["kg", "lb"]).default("kg"),
});
const CommitRequest = ImportRequest.extend({
  /** Per imported exercise name: a catalogue id, "create" (custom exercise) or "skip". Unlisted names use the automatic match, else "create". */
  exerciseChoices: z.record(z.string().max(200), z.union([z.uuid(), z.enum(["create", "skip"])])).default({}),
  /** Mark days with imported meals as complete (used by adaptive targets). Off by default: an export can't tell us whether a day was fully logged. */
  markDaysComplete: z.boolean().default(false),
});

const SOURCE_LABEL: Record<ParsedImport["source"], string> = { strong: "Strong", hevy: "Hevy", mfp_nutrition: "MyFitnessPal", mfp_measurements: "MyFitnessPal" };
const MEAL_LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks" };
const MEAL_TIME: Record<string, string> = { breakfast: "08:00", lunch: "13:00", dinner: "19:30", snacks: "16:00" };
const MAX = { workouts: 5000, meals: 40000, weights: 20000 };

function parseOrThrow(body: z.infer<typeof ImportRequest>): ParsedImport {
  try {
    const parsed = parseImport(body.text, { weightUnit: body.weightUnit }, body.source);
    if (parsed.workouts.length > MAX.workouts || parsed.meals.length > MAX.meals || parsed.weights.length > MAX.weights) throw badRequest("This export is larger than one import allows. Split it by year and import each part.");
    return parsed;
  } catch (e) {
    if (e instanceof ImportFormatError) throw badRequest(e.message);
    throw e;
  }
}

function exerciseNames(workouts: readonly ImportedWorkout[]) {
  const counts = new Map<string, number>();
  for (const w of workouts) for (const e of w.exercises) counts.set(e.name, (counts.get(e.name) ?? 0) + e.sets.length);
  return counts;
}

async function autoMatch(tx: Tx, name: string): Promise<{ id: string; name: string } | null> {
  // The user's own exercise with exactly this name (e.g. created by an earlier import) wins.
  const [own] = await tx.select({ id: exercises.id, name: exercises.name }).from(exercises).where(and(isNotNull(exercises.ownerUserId), eq(exercises.name, name.slice(0, 120))));
  if (own) return own;
  for (const q of exerciseQueries(name)) {
    const m = (await matchExercise(tx, q)).find((c) => acceptsExerciseMatch(name, c.name));
    if (m) return { id: m.id, name: m.name };
  }
  return null;
}

const range = (days: string[]) => (days.length ? { from: days.reduce((a, b) => (a < b ? a : b)), to: days.reduce((a, b) => (a > b ? a : b)) } : null);

export function registerImportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx), bodyLimit: 25 * 1024 * 1024 };

  app.post("/v1/import/preview", auth, async (req) => {
    const body = parse(ImportRequest, req.body);
    const parsed = parseOrThrow(body);
    const names = exerciseNames(parsed.workouts);
    const matches = await ctx.db.asUser(req.userId, async (tx) => {
      const out = [];
      for (const [name, sets] of names) out.push({ name, sets, match: await autoMatch(tx, name) });
      return out;
    });
    return {
      source: parsed.source,
      sourceLabel: SOURCE_LABEL[parsed.source],
      rowsRead: parsed.rowsRead,
      workouts: { count: parsed.workouts.length, sets: parsed.workouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.sets.length, 0), 0), range: range(parsed.workouts.map((w) => w.day)) },
      meals: { count: parsed.meals.length, days: new Set(parsed.meals.map((m) => m.day)).size, range: range(parsed.meals.map((m) => m.day)) },
      weights: { count: parsed.weights.length, range: range(parsed.weights.map((w) => w.day)) },
      exercises: matches.sort((a, b) => b.sets - a.sets),
      warnings: parsed.warnings,
    };
  });

  app.post("/v1/import/commit", auth, async (req) => {
    const body = parse(CommitRequest, req.body);
    const parsed = parseOrThrow(body);
    const userId = req.userId;
    const ns = `import:${userId}:${parsed.source}`;
    const now = ctx.now();
    const profile = await ctx.db.asUser(userId, (tx) => getProfile(tx, userId));
    const tz = profile.timeZone;

    // Resolve every exercise name once.
    const resolved = new Map<string, string | null>();
    const created: string[] = [];
    await ctx.db.asUser(userId, async (tx) => {
      for (const name of exerciseNames(parsed.workouts).keys()) {
        const choice = body.exerciseChoices[name];
        if (choice === "skip") {
          resolved.set(name, null);
          continue;
        }
        if (choice && choice !== "create") {
          const [ok] = await tx.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, choice));
          if (!ok) throw badRequest(`Unknown exercise chosen for "${name}"`);
          resolved.set(name, choice);
          continue;
        }
        const match = choice === "create" ? null : await autoMatch(tx, name);
        if (match) {
          resolved.set(name, match.id);
          continue;
        }
        const [own] = await tx.select({ id: exercises.id }).from(exercises).where(and(isNotNull(exercises.ownerUserId), eq(exercises.name, name.slice(0, 120))));
        if (own) {
          resolved.set(name, own.id);
          continue;
        }
        const equip = /\(([^)]*)\)/.exec(name)?.[1]?.toLowerCase() ?? "other";
        const [row] = await tx
          .insert(exercises)
          .values({ ownerUserId: userId, slug: `import-${deterministicUuid(ns, `exercise:${name}`).slice(0, 13)}`, name: name.slice(0, 120), primaryMuscles: ["unspecified"], equipment: equip.slice(0, 40), category: "strength", movementPattern: "unspecified", mechanics: "isolation", difficulty: "intermediate", loadProfile: /barbell/.test(equip) ? "barbell" : /dumbbell/.test(equip) ? "dumbbell" : /cable/.test(equip) ? "cable" : /body/.test(equip) ? "bodyweight" : "machine", license: "user" })
          .returning({ id: exercises.id });
        resolved.set(name, row!.id);
        created.push(name);
      }
    });

    const result = { workouts: { imported: 0, alreadyPresent: 0 }, sets: 0, meals: { imported: 0, alreadyPresent: 0 }, weights: { imported: 0, alreadyPresent: 0 }, exercisesCreated: created, daysMarkedComplete: 0, warnings: parsed.warnings };

    // Oldest first, so each workout's PRs and next targets see the ones before it.
    const workouts = [...parsed.workouts].sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1));
    for (const w of workouts) {
      const sessionId = deterministicUuid(ns, `workout:${w.key}`);
      const started = localTimeToUtc(w.day, w.time, tz);
      const ended = new Date(started.getTime() + (w.durationSec ?? 0) * 1000);
      const exs = w.exercises
        .map((e, i) => ({ e, i, exerciseId: resolved.get(e.name) ?? null }))
        .filter((x): x is { e: (typeof w.exercises)[number]; i: number; exerciseId: string } => !!x.exerciseId)
        .slice(0, 100)
        .map(({ e, i, exerciseId }, position) => ({
          id: deterministicUuid(sessionId, `exercise:${i}`),
          exerciseId,
          position,
          notes: e.notes?.slice(0, 1000) ?? null,
          sets: e.sets.slice(0, 100).map((s, j) => ({ id: deterministicUuid(sessionId, `set:${i}:${j}`), position: j, kind: s.kind, weightKg: s.weightKg, reps: Math.min(s.reps, 1000), rpe: s.rpe, completed: true, completedAt: null, originalUnit: body.weightUnit })),
        }));
      if (!exs.length) continue;
      const out = await ctx.db.asUser(userId, (tx) =>
        upsertWorkout(tx, userId, sessionId, { name: w.name.slice(0, 120), day: w.day, startedAt: started.toISOString(), endedAt: ended.toISOString(), pausedSec: 0, status: "completed", notes: w.notes?.slice(0, 2000) ?? null, clientUpdatedAt: ended.toISOString(), exercises: exs }, now),
      );
      if (out.applied) {
        result.workouts.imported++;
        result.sets += exs.reduce((a, e) => a + e.sets.length, 0);
      } else result.workouts.alreadyPresent++;
    }

    if (parsed.meals.length) {
      await ctx.db.asUser(userId, async (tx) => {
        for (const m of parsed.meals) {
          if (typeof m.nutrients.energyKcal !== "number") continue;
          const at = localTimeToUtc(m.day, MEAL_TIME[m.meal] ?? "12:00", tz).toISOString();
          const description = `${MEAL_LABEL[m.meal] ?? m.meal} (imported from ${SOURCE_LABEL[parsed.source]})`;
          const out = await upsertFoodLog(tx, userId, deterministicUuid(ns, `meal:${m.day}:${m.meal}`), { day: m.day, loggedAt: at, meal: m.meal, clientUpdatedAt: at, description, nutrients: m.nutrients, provenance: "import", note: m.note?.slice(0, 500) ?? null }, now);
          if (out.applied) result.meals.imported++;
          else result.meals.alreadyPresent++;
        }
        if (body.markDaysComplete) {
          for (const day of new Set(parsed.meals.map((m) => m.day))) {
            await tx.insert(diaryDays).values({ userId, day, status: "complete" }).onConflictDoNothing();
            result.daysMarkedComplete++;
          }
        }
      });
    }

    if (parsed.weights.length) {
      await ctx.db.asUser(userId, async (tx) => {
        for (const w of parsed.weights) {
          const measuredAt = localTimeToUtc(w.day, "08:00", tz);
          const rows = await tx
            .insert(bodyMeasurements)
            .values({ id: deterministicUuid(ns, `weight:${w.day}`), userId, day: w.day, measuredAt, kind: "weight", value: w.kg, source: `import:${parsed.source}`, sourceRecordId: w.day, clientUpdatedAt: measuredAt })
            .onConflictDoNothing()
            .returning({ id: bodyMeasurements.id });
          if (rows.length) result.weights.imported++;
          else result.weights.alreadyPresent++;
        }
      });
    }

    await ctx.db.asUser(userId, (tx) => tx.insert(auditEvents).values({ userId, event: "data.imported", metadata: { source: parsed.source, workouts: result.workouts.imported, meals: result.meals.imported, weights: result.weights.imported } }));
    return result;
  });
}
