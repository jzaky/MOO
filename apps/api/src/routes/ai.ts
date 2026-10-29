import { ParseLogRequest, RecognitionConfirmRequest } from "@moo/contracts";
import {
  checkEnergyConsistency,
  sharesKeyWord,
  dayKeyInZone,
  consumedFraction,
  estimateMeal,
  isKnown,
  kjToKcal,
  lbToKg,
  mealFromUtterance,
  parseLogUtterance,
  perServingToPer100,
  type NutrientValues,
  type ParsedFoodItem,
  type ParsedIntent,
} from "@moo/core";
import type { MultipartFile } from "@fastify/multipart";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { LABEL_SYSTEM, LabelAnalysis, MEAL_PHOTO_SYSTEM, MealPhotoAnalysis, MENU_SYSTEM, MenuAnalysis, PARSE_SYSTEM, ParsedLogAi, prepareImage } from "../ai/foodVision";
import { mealSuggestions } from "../services/insights";
import type { AiUsage } from "../ai/provider";
import type { Tx } from "../db/client";
import { exercises, foodRecognitions, usageEvents } from "../db/schema";
import { searchLocalFoods, upsertSharedFood, type FoodDto } from "../foods/repository";
import { badRequest, HttpError, notFound, parse } from "../http/errors";
import { makeRequireAuth, type AppContext } from "../http/context";
import { upsertFoodLog } from "./diary";
import { getProfile, profileToDto } from "./profile";
import { suggestPortion } from "./recipes";

export async function recordUsage(tx: Tx, userId: string, feature: string, usage: AiUsage): Promise<void> {
  await tx.insert(usageEvents).values({ userId, feature, provider: usage.provider, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
}

async function readImages(req: FastifyRequest, max = 4): Promise<{ images: Buffer[]; fields: Record<string, string> }> {
  if (!req.isMultipart()) throw badRequest("Expected multipart/form-data with image files");
  const images: Buffer[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const f = part as MultipartFile;
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.mimetype)) throw badRequest("Only JPEG, PNG, WebP or HEIC images are accepted");
      const buf = await f.toBuffer();
      if (images.length >= max) throw badRequest(`At most ${max} images`);
      images.push(buf);
    } else {
      fields[part.fieldname] = String((part as { value: unknown }).value ?? "").slice(0, 1000);
    }
  }
  if (!images.length) throw badRequest("Attach at least one image");
  return { images, fields };
}

async function requirePhotoConsent(ctx: AppContext, userId: string) {
  const consent = await ctx.db.asUser(userId, async (tx) => profileToDto(await getProfile(tx, userId)).aiConsent);
  if (!consent.photoAnalysis) throw new HttpError(403, "consent_required", "Enable photo analysis in Privacy settings first. Photos are sent to the AI provider for analysis.");
  return consent;
}

/** Find database candidates for a recognized component; fall back to online sources. */
async function candidatesFor(ctx: AppContext, userId: string, query: string): Promise<FoodDto[]> {
  let local = await ctx.db.asUser(userId, (tx) => searchLocalFoods(tx, userId, query, 5));
  if (local.length < 2) {
    try {
      const remote = await ctx.foodSources.search(query, { limit: 8 });
      for (const n of remote.filter((r) => r.quality.completeness === 1)) await upsertSharedFood(ctx.db.system, n, ctx.now());
      local = await ctx.db.asUser(userId, (tx) => searchLocalFoods(tx, userId, query, 5));
    } catch {
      /* online sources optional */
    }
  }
  // Prefer complete, generic (non-branded) records for photo estimates.
  return local.sort((a, b) => b.completeness - a.completeness || Number(!!a.brand) - Number(!!b.brand)).slice(0, 3);
}

export function registerAiRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: makeRequireAuth(ctx), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  /** Analyze 1–4 meal photos. Returns an editable draft; nothing is logged. */
  app.post("/v1/ai/meal-photo", auth, async (req) => {
    if (!ctx.ai.available) throw new HttpError(503, "ai_unavailable", "Photo recognition is not configured on this server");
    const consent = await requirePhotoConsent(ctx, req.userId);
    const { images, fields } = await readImages(req);
    const prepared = await Promise.all(images.map((b) => prepareImage(b).catch(() => { throw badRequest("One of the images could not be read"); })));
    const mode = fields.mode === "before_after" && prepared.length === 2 ? "before_after" : "standard";
    const instruction =
      mode === "before_after"
        ? "Image 1 is the meal before eating, image 2 is what was left. Analyse image 1 for components and estimate leftoverFraction from image 2."
        : prepared.length > 1
          ? "These images show the same meal from different angles."
          : "Analyse this meal.";
    const userNote = fields.note ? `User note: ${fields.note}` : "";
    const { data, usage } = await ctx.ai.structured({
      purpose: "food_photo",
      system: MEAL_PHOTO_SYSTEM,
      content: [...prepared.map((p) => p.part), { type: "text", text: [instruction, userNote].filter(Boolean).join("\n") }],
      schema: MealPhotoAnalysis,
      effort: "medium",
    });

    // Temporarily keep the (metadata-stripped) images until the user confirms or discards.
    const keys = await Promise.all(prepared.map((p) => ctx.media.put(req.userId, "meal", p.jpeg, "image/jpeg")));
    const factor = mode === "before_after" && data.leftoverFraction != null ? consumedFraction(data.leftoverFraction) : 1;

    const components = [];
    for (const [i, c] of data.components.entries()) {
      const [low, est, high] = [c.gramsLow, c.gramsEstimate, c.gramsHigh].sort((a, b) => a - b) as [number, number, number];
      const cands = await candidatesFor(ctx, req.userId, c.searchQuery || c.label);
      components.push({ id: `c${i + 1}`, ai: c, grams: { estimate: est * factor, low: low * factor, high: high * factor }, candidates: cands });
    }
    const estimate = estimateMeal(
      components.map((c) => ({
        id: c.id,
        label: c.ai.label,
        identityConfidence: c.ai.identityConfidence,
        portionConfidence: c.ai.portionConfidence,
        grams: c.grams,
        matchedPer100: c.candidates[0] && c.candidates[0].completeness === 1 ? c.candidates[0].per100 : null,
        alternatives: c.ai.alternatives,
      })),
    );
    const result = {
      mode,
      isFood: data.isFood,
      leftoverFraction: data.leftoverFraction,
      consumedFactor: factor,
      clarifyingQuestions: data.clarifyingQuestions,
      notes: data.notes,
      components: components.map((c) => {
        const e = estimate.components.find((x) => x.id === c.id)!;
        const top = c.candidates[0];
        return {
          id: c.id,
          label: c.ai.label,
          cookingMethod: c.ai.cookingMethod,
          alternatives: c.ai.alternatives,
          hiddenIngredientRisk: c.ai.hiddenIngredientRisk,
          portionBasis: c.ai.portionBasis,
          identityConfidence: c.ai.identityConfidence,
          portionConfidence: c.ai.portionConfidence,
          tier: e.tier,
          needsUserInput: e.needsUserInput,
          grams: { estimate: Math.round(c.grams.estimate), low: Math.round(c.grams.low), high: Math.round(c.grams.high) },
          candidates: c.candidates.map((f) => ({ id: f.id, name: f.name, brand: f.brand, source: f.source, per100: f.per100, completeness: f.completeness })),
          suggested: top ? { foodId: top.id, portion: { kind: "amount", quantity: Math.round(c.grams.estimate), unit: top.baseUnit } } : null,
          nutrients: e.nutrients,
          energyRangeKcal: e.energyRangeKcal ? { low: Math.round(e.energyRangeKcal.low), high: Math.round(e.energyRangeKcal.high) } : null,
        };
      }),
      totals: estimate.totals,
      energyRangeKcal: estimate.energyRangeKcal,
      status: data.isFood ? estimate.status : "not_food",
      disclaimer: "Photo estimates can be off by a wide margin, especially for oils, sauces and mixed dishes. Adjust amounts before saving.",
    };
    const row = await ctx.db.asUser(req.userId, async (tx) => {
      const [r] = await tx.insert(foodRecognitions).values({ userId: req.userId, kind: "meal_photo", status: "analyzed", imageKeys: keys, model: usage.model, result }).returning({ id: foodRecognitions.id });
      await recordUsage(tx, req.userId, "food_photo", usage);
      return r!;
    });
    return { recognitionId: row.id, ...result, imagesRetained: consent.retainMealPhotos };
  });

  /** Confirm (possibly edited) components → diary entries labelled as AI estimates. */
  app.post("/v1/ai/meal-photo/:id/confirm", { preHandler: makeRequireAuth(ctx) }, async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(RecognitionConfirmRequest, req.body);
    const out = await ctx.db.asUser(req.userId, async (tx) => {
      const [rec] = await tx.select().from(foodRecognitions).where(eq(foodRecognitions.id, id));
      if (!rec) throw notFound("Recognition");
      if (rec.status === "discarded") throw badRequest("This analysis was discarded");
      const consent = profileToDto(await getProfile(tx, req.userId)).aiConsent;
      const entries = [];
      for (const item of body.items) {
        const r = await upsertFoodLog(tx, req.userId, item.id, { day: body.day, meal: body.meal, loggedAt: body.loggedAt, clientUpdatedAt: body.loggedAt, foodId: item.foodId, portion: item.portion, provenance: "ai_estimate", recognitionId: id }, ctx.now());
        entries.push(r.entry);
      }
      const keep = body.keepImages && consent.retainMealPhotos;
      await tx.update(foodRecognitions).set({ status: "confirmed", confirmedAt: ctx.now(), imageKeys: keep ? rec.imageKeys : [] }).where(eq(foodRecognitions.id, id));
      return { entries, deleteKeys: keep ? [] : rec.imageKeys };
    });
    await Promise.all(out.deleteKeys.map((k) => ctx.media.delete(k)));
    return { entries: out.entries, imagesDeleted: out.deleteKeys.length };
  });

  app.post("/v1/ai/meal-photo/:id/discard", { preHandler: makeRequireAuth(ctx) }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const keys = await ctx.db.asUser(req.userId, async (tx) => {
      const [rec] = await tx.select().from(foodRecognitions).where(eq(foodRecognitions.id, id));
      if (!rec) throw notFound("Recognition");
      await tx.update(foodRecognitions).set({ status: "discarded", imageKeys: [] }).where(eq(foodRecognitions.id, id));
      return rec.imageKeys;
    });
    await Promise.all(keys.map((k) => ctx.media.delete(k)));
    return reply.status(204).send();
  });

  /** Read a nutrition label photo into a DRAFT custom food. */
  app.post("/v1/ai/nutrition-label", auth, async (req) => {
    if (!ctx.ai.available) throw new HttpError(503, "ai_unavailable", "Label scanning is not configured on this server");
    await requirePhotoConsent(ctx, req.userId);
    const { images, fields } = await readImages(req, 2);
    const prepared = await Promise.all(images.map((b) => prepareImage(b)));
    const { data, usage } = await ctx.ai.structured({ purpose: "label_ocr", system: LABEL_SYSTEM, content: [...prepared.map((p) => p.part), { type: "text", text: "Transcribe the nutrition facts." }], schema: LabelAnalysis, effort: "medium" });
    await ctx.db.asUser(req.userId, (tx) => recordUsage(tx, req.userId, "label_ocr", usage));
    if (!data.isNutritionLabel) throw new HttpError(422, "not_a_label", "No nutrition facts panel was found in the photo. Try again closer and in good light.");
    return buildLabelDraft(data, fields.barcode ?? null);
  });

  /**
   * Restaurant menu (photo or pasted text) → dishes ranked by fit to what is
   * left today. Printed values are labelled "printed"; everything else is a
   * labelled estimate with a range. Exact restaurant macros are never invented.
   */
  app.post("/v1/ai/menu", auth, async (req) => {
    if (!ctx.ai.available) throw new HttpError(503, "ai_unavailable", "Menu analysis is not configured on this server");
    let content: Parameters<typeof ctx.ai.structured>[0]["content"];
    if (req.isMultipart()) {
      await requirePhotoConsent(ctx, req.userId);
      const { images } = await readImages(req, 3);
      content = [...(await Promise.all(images.map((b) => prepareImage(b)))).map((p) => p.part), { type: "text", text: "Read this menu." }];
    } else {
      const body = parse(z.object({ text: z.string().min(3).max(20000) }), req.body);
      content = [{ type: "text", text: `Menu:\n${body.text}` }];
    }
    const { data, usage } = await ctx.ai.structured({ purpose: "menu", system: MENU_SYSTEM, content, schema: MenuAnalysis, effort: "medium" });
    await ctx.db.asUser(req.userId, (tx) => recordUsage(tx, req.userId, "menu", usage));
    const p = await ctx.db.asUser(req.userId, (tx) => getProfile(tx, req.userId));
    const remaining = await ctx.db.asUser(req.userId, async (tx) => (await mealSuggestions(tx, req.userId, dayKeyInZone(ctx.now(), p.timeZone), 0)).remaining);
    const dishes = [];
    for (const item of data.items) {
      if (item.printedNutrition && item.printedNutrition.energyKcal != null) {
        dishes.push({ name: item.name, description: item.description, basis: "printed" as const, energyKcal: item.printedNutrition.energyKcal, energyRangeKcal: null, proteinG: item.printedNutrition.proteinG, carbsG: item.printedNutrition.carbsG, fatG: item.printedNutrition.fatG, unmatchedComponents: [] as string[] });
        continue;
      }
      const comps = [];
      const unmatched: string[] = [];
      for (const [i, c] of item.components.entries()) {
        const [best] = await candidatesFor(ctx, req.userId, c.searchQuery);
        const [low, est, high] = [c.gramsLow, c.gramsEstimate, c.gramsHigh].sort((a, b) => a - b) as [number, number, number];
        if (!best || best.completeness < 1) unmatched.push(c.searchQuery);
        comps.push({ id: `c${i}`, label: c.searchQuery, identityConfidence: 0.7, portionConfidence: 0.4, grams: { estimate: est, low, high }, matchedPer100: best && best.completeness === 1 ? best.per100 : null });
      }
      const e = estimateMeal(comps);
      dishes.push({ name: item.name, description: item.description, basis: "estimate" as const, energyKcal: isKnown(e.totals.energyKcal) ? Math.round(e.totals.energyKcal) : null, energyRangeKcal: e.energyRangeKcal, proteinG: isKnown(e.totals.proteinG) ? Math.round(e.totals.proteinG) : null, carbsG: isKnown(e.totals.carbsG) ? Math.round(e.totals.carbsG) : null, fatG: isKnown(e.totals.fatG) ? Math.round(e.totals.fatG) : null, unmatchedComponents: unmatched });
    }
    const remE = remaining?.energyKcal ?? null, remP = remaining?.proteinG ?? null;
    const scored = dishes
      .map((d) => ({ ...d, fit: d.energyKcal == null || remE == null ? null : Math.round(((remP && d.proteinG ? Math.min(d.proteinG, remP) / Math.max(remP, 1) : 0) * 2 - Math.max(0, d.energyKcal - Math.max(remE, 0)) / Math.max(remE, 300)) * 100) / 100 }))
      .sort((a, b) => (b.fit ?? -99) - (a.fit ?? -99));
    return { restaurant: data.restaurant, remaining, dishes: scored, disclaimer: "Values marked 'estimate' are approximations from typical portions and generic foods; restaurant portions and cooking fats vary widely." };
  });

  /** Text (or transcribed voice) → structured DRAFT with database matches. Never writes. */
  app.post("/v1/log/parse", { preHandler: makeRequireAuth(ctx) }, async (req) => {
    const body = parse(ParseLogRequest, req.body);
    return parseAndMatch(ctx, req.userId, body.text);
  });

  app.post("/v1/voice/transcribe", auth, async (req) => {
    if (!ctx.stt.available) throw new HttpError(503, "stt_unavailable", "Voice transcription is not configured on this server. Use the keyboard dictation button instead.");
    if (!req.isMultipart()) throw badRequest("Expected multipart audio");
    const file = await req.file();
    if (!file || !/^audio\//.test(file.mimetype)) throw badRequest("Attach an audio file");
    const audio = await file.toBuffer();
    const { text } = await ctx.stt.transcribe(audio, file.mimetype);
    // Audio is never stored.
    return { text, draft: await parseAndMatch(ctx, req.userId, text) };
  });
}

export function buildLabelDraft(data: LabelAnalysis, barcode: string | null) {
  const flags: string[] = [];
  const toValues = (v: NonNullable<LabelAnalysis["per100"]>): NutrientValues => {
    const out: NutrientValues = {};
    const kcal = v.energyKcal ?? (v.energyKj != null ? Math.round(kjToKcal(v.energyKj) * 10) / 10 : null);
    if (v.energyKcal == null && v.energyKj != null) flags.push("energy_from_kj");
    if (kcal != null) out.energyKcal = kcal;
    for (const k of ["proteinG", "carbsG", "sugarG", "fatG", "saturatedFatG", "fiberG"] as const) if (v[k] != null) out[k] = v[k]!;
    if (v.sodiumMg != null) out.sodiumMg = v.sodiumMg;
    else if (v.saltG != null) {
      out.sodiumMg = Math.round((v.saltG / 2.5) * 1000);
      flags.push("sodium_from_salt");
    }
    return out;
  };
  let per100: NutrientValues | null = data.per100 ? toValues(data.per100) : null;
  const perServing = data.perServing ? toValues(data.perServing) : null;
  if (!per100 && perServing && data.servingSizeAmount) {
    per100 = perServingToPer100(perServing, data.servingSizeAmount);
    flags.push("per100_derived_from_serving");
  }
  if (per100 && perServing && data.servingSizeAmount && isKnown(per100.energyKcal) && isKnown(perServing.energyKcal)) {
    const implied = (per100.energyKcal * data.servingSizeAmount) / 100;
    if (Math.abs(implied - perServing.energyKcal) > Math.max(10, perServing.energyKcal * 0.1)) flags.push("per100_per_serving_mismatch");
  }
  if (per100 && !checkEnergyConsistency(per100).ok) flags.push("energy_macro_mismatch");
  return {
    draft: {
      name: data.productName ?? "",
      brand: data.brand,
      barcode,
      baseUnit: data.servingSizeUnit ?? "g",
      per100: per100 ?? {},
      servings: data.servingSizeAmount ? [{ label: data.servingSizeText ?? `${data.servingSizeAmount} ${data.servingSizeUnit ?? "g"}`, baseAmount: data.servingSizeAmount }] : [],
      source: "label" as const,
    },
    unreadableFields: data.unreadableFields,
    flags,
    needsReview: flags.length > 0 || data.unreadableFields.length > 0 || !per100,
  };
}

async function matchExercise(tx: Tx, name: string) {
  const q = name.toLowerCase().trim();
  const rows = await tx
    .select({ id: exercises.id, name: exercises.name, slug: exercises.slug })
    .from(exercises)
    .where(sql`lower(${exercises.name}) % ${q} or lower(${exercises.name}) like ${"%" + q.replace(/[%_]/g, "") + "%"} or exists (select 1 from unnest(${exercises.aliases}) a where lower(a) = ${q})`)
    .orderBy(sql`(exists (select 1 from unnest(${exercises.aliases}) a where lower(a) = ${q}))::int desc, similarity(lower(${exercises.name}), ${q}) desc`)
    .limit(3);
  return rows;
}

function aiToIntent(a: ParsedLogAi): ParsedIntent {
  const issues = [...a.ambiguities];
  if (a.kind === "body_weight" && a.bodyWeight) {
    const kg = a.bodyWeight.unit === "lb" ? lbToKg(a.bodyWeight.value) : a.bodyWeight.value;
    return { kind: "body_weight", weightKg: Math.round(kg * 100) / 100, original: a.bodyWeight, issues };
  }
  if (a.kind === "water" && a.waterMl) return { kind: "water", ml: a.waterMl, issues };
  if (a.kind === "exercise" && a.exercises.length) {
    return {
      kind: "exercise",
      issues,
      entries: a.exercises.map((e) => ({
        text: e.name,
        exerciseName: e.name,
        sets: e.sets ?? 1,
        reps: e.reps,
        weightKg: e.weight == null ? null : Math.round((e.weightUnit === "lb" ? lbToKg(e.weight) : e.weight) * 100) / 100,
        originalWeight: e.weight == null ? null : { value: e.weight, unit: e.weightUnit ?? "kg" },
      })),
    };
  }
  if (a.kind === "food" && a.foods.length) {
    const countUnits = new Set(["piece", "slice", "serving", "bowl", "scoop", "handful"]);
    return {
      kind: "food",
      issues,
      items: a.foods.map((f) => ({
        text: f.name,
        name: f.name,
        quantity: f.quantity ?? 1,
        quantityAssumed: f.quantity == null,
        unit: f.unit == null || countUnits.has(f.unit) ? { count: f.unit && f.unit !== "piece" ? f.unit : "" } : (f.unit as Exclude<ParsedFoodItem["unit"], { count: string }>),
      })),
    };
  }
  return { kind: "unrecognized", issues: issues.length ? issues : ["Could not recognise this as a log entry."] };
}

export async function parseAndMatch(ctx: AppContext, userId: string, text: string) {
  let intent = parseLogUtterance(text);
  let parser: "rules" | "ai" = "rules";
  if (intent.kind === "unrecognized" && ctx.ai.available) {
    const { data, usage } = await ctx.ai.structured({ purpose: "log_parse", system: PARSE_SYSTEM, content: [{ type: "text", text }], schema: ParsedLogAi, effort: "low", maxTokens: 2000 });
    await ctx.db.asUser(userId, (tx) => recordUsage(tx, userId, "log_parse", usage));
    intent = aiToIntent(data);
    parser = "ai";
  }
  const meal = mealFromUtterance(text);
  return ctx.db.asUser(userId, async (tx) => {
    if (intent.kind === "food") {
      const items = [];
      for (const item of intent.items) {
        const candidates = await searchLocalFoods(tx, userId, item.name, 3);
        const withPortions = candidates.map((f) => ({ food: f, portion: suggestPortion(item, f) }));
        // Suggest the best-ranked food; if its amount can't be derived, the client asks for one.
        items.push({ parsed: item, candidates: withPortions, suggestion: withPortions[0] && sharesKeyWord(item.name, withPortions[0].food.name) ? withPortions[0] : null });
      }
      return { parser, kind: intent.kind, meal, items, issues: intent.issues, requiresConfirmation: true };
    }
    if (intent.kind === "exercise") {
      const entries = [];
      for (const e of intent.entries) entries.push({ parsed: e, matches: await matchExercise(tx, e.exerciseName) });
      return { parser, kind: intent.kind, entries, issues: intent.issues, requiresConfirmation: true };
    }
    return { parser, ...intent, requiresConfirmation: true };
  });
}

