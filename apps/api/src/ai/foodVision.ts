import { z } from "zod";
import sharp from "sharp";
import type { AiPart } from "./provider";

/**
 * Prompts and output schemas for food vision. The model's job is limited to
 * perception: identify visible components, give a generic name to search the
 * food database with, and estimate portion RANGES with confidences. It never
 * returns calories — nutrition comes from the database and arithmetic from
 * @stoke/core.
 */

export const MealPhotoAnalysis = z.object({
  isFood: z.boolean(),
  components: z
    .array(
      z.object({
        label: z.string().max(80),
        searchQuery: z.string().max(80),
        cookingMethod: z.string().max(40).nullable(),
        identityConfidence: z.number().min(0).max(1),
        alternatives: z.array(z.string().max(80)).max(4),
        gramsEstimate: z.number().min(0).max(3000),
        gramsLow: z.number().min(0).max(3000),
        gramsHigh: z.number().min(0).max(4000),
        portionConfidence: z.number().min(0).max(1),
        portionBasis: z.string().max(200),
        hiddenIngredientRisk: z.string().max(200).nullable(),
      }),
    )
    .max(15),
  leftoverFraction: z.number().min(0).max(1).nullable(),
  clarifyingQuestions: z.array(z.string().max(200)).max(4),
  notes: z.string().max(400),
});
export type MealPhotoAnalysis = z.infer<typeof MealPhotoAnalysis>;

export const MEAL_PHOTO_SYSTEM = `You analyse meal photos for a nutrition logging app. Your output is a DRAFT that the user will review and correct.

Your task is perception only:
- List each visible food component separately (e.g. grilled chicken, white rice, avocado, mixed vegetables, sauce).
- For each, give a short generic "searchQuery" suitable for a food database (e.g. "chicken breast, grilled", "rice, white, cooked").
- Estimate the edible portion in grams as a best estimate plus a plausible low–high range. Base it on visible cues (plate size, utensils, hands, packaging) and say what you used in "portionBasis". Ranges should be honest: wide when cues are weak.
- identityConfidence and portionConfidence are 0–1. Use < 0.5 when you are guessing. Do not inflate confidence.
- Note likely hidden calories (cooking oil, butter, dressings, sugar in sauces) in "hiddenIngredientRisk" instead of silently adding them.
- If the user provided a before and an after photo, estimate "leftoverFraction" (0 = everything eaten, 1 = nothing eaten); otherwise null.
- Ask up to 4 short clarifying questions only when the answer would materially change the estimate (e.g. "Was this cooked in oil?").
- Never state calories or macros. If the image is not food, set isFood=false and return no components.`;

export const LabelAnalysis = z.object({
  isNutritionLabel: z.boolean(),
  productName: z.string().max(200).nullable(),
  brand: z.string().max(120).nullable(),
  servingSizeText: z.string().max(80).nullable(),
  servingSizeAmount: z.number().min(0).max(5000).nullable(),
  servingSizeUnit: z.enum(["g", "ml"]).nullable(),
  basis: z.enum(["per_100", "per_serving", "both"]),
  per100: z
    .object({ energyKcal: z.number().nullable(), energyKj: z.number().nullable(), proteinG: z.number().nullable(), carbsG: z.number().nullable(), sugarG: z.number().nullable(), fatG: z.number().nullable(), saturatedFatG: z.number().nullable(), fiberG: z.number().nullable(), sodiumMg: z.number().nullable(), saltG: z.number().nullable() })
    .nullable(),
  perServing: z
    .object({ energyKcal: z.number().nullable(), energyKj: z.number().nullable(), proteinG: z.number().nullable(), carbsG: z.number().nullable(), sugarG: z.number().nullable(), fatG: z.number().nullable(), saturatedFatG: z.number().nullable(), fiberG: z.number().nullable(), sodiumMg: z.number().nullable(), saltG: z.number().nullable() })
    .nullable(),
  unreadableFields: z.array(z.string().max(40)).max(20),
  languageNotes: z.string().max(200).nullable(),
});
export type LabelAnalysis = z.infer<typeof LabelAnalysis>;

export const LABEL_SYSTEM = `You transcribe nutrition facts panels from photos for a food logging app. Labels may be in English, Arabic, French or other languages and may follow EU, US, or GCC formats.

Rules:
- Transcribe ONLY numbers printed on the label. Never estimate or fill in a value that is not printed or not legible: use null and add the field name to "unreadableFields".
- Report values in the column they appear in: "per100" for per 100 g / 100 ml columns, "perServing" for per-serving columns. Set "basis" accordingly.
- Energy: copy kcal and kJ separately as printed. Sodium in mg if printed as sodium; salt in g if printed as salt. Do not convert.
- servingSizeAmount/servingSizeUnit only when the label states the serving weight or volume in g or ml.`;

export const ParsedLogAi = z.object({
  kind: z.enum(["food", "exercise", "body_weight", "water", "unknown"]),
  foods: z
    .array(
      z.object({
        name: z.string().max(100),
        quantity: z.number().min(0).max(10000).nullable(),
        unit: z.enum(["g", "kg", "ml", "l", "oz", "lb", "cup", "tbsp", "tsp", "piece", "slice", "serving", "bowl", "scoop", "handful"]).nullable(),
        brandOrRestaurant: z.string().max(100).nullable(),
      }),
    )
    .max(20),
  meal: z.enum(["breakfast", "lunch", "dinner", "snacks"]).nullable(),
  exercises: z
    .array(z.object({ name: z.string().max(100), sets: z.number().int().min(1).max(30).nullable(), reps: z.number().int().min(0).max(200).nullable(), weight: z.number().min(0).max(1000).nullable(), weightUnit: z.enum(["kg", "lb"]).nullable() }))
    .max(20),
  bodyWeight: z.object({ value: z.number().min(0).max(800), unit: z.enum(["kg", "lb"]) }).nullable(),
  waterMl: z.number().min(0).max(10000).nullable(),
  ambiguities: z.array(z.string().max(200)).max(6),
});
export type ParsedLogAi = z.infer<typeof ParsedLogAi>;

export const PARSE_SYSTEM = `You convert a short spoken or typed logging message into structured data for a fitness app. The result is shown to the user for confirmation before anything is saved.

- Extract only what the user said. Never invent quantities: if an amount is not stated, use null and add a note to "ambiguities".
- Keep foods separate ("three eggs and two slices of toast" = two foods).
- Exercise loads: copy the number and unit the user said.
- If the message is a question or not a log, use kind "unknown".`;

const MAX_EDGE = 1568;

/** Normalize an uploaded image: auto-rotate, downscale, re-encode as JPEG, strip all metadata (incl. GPS). */
export async function prepareImage(input: Buffer): Promise<{ jpeg: Buffer; part: AiPart; width: number; height: number }> {
  const img = sharp(input, { failOn: "error" }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Unreadable image");
  const jpeg = await img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const out = await sharp(jpeg).metadata();
  return { jpeg, part: { type: "image", mediaType: "image/jpeg", base64: jpeg.toString("base64") }, width: out.width ?? 0, height: out.height ?? 0 };
}

export const MenuAnalysis = z.object({
  restaurant: z.string().max(120).nullable(),
  items: z
    .array(
      z.object({
        name: z.string().max(120),
        description: z.string().max(300).nullable(),
        printedNutrition: z.object({ energyKcal: z.number().nullable(), proteinG: z.number().nullable(), carbsG: z.number().nullable(), fatG: z.number().nullable() }).nullable(),
        components: z.array(z.object({ searchQuery: z.string().max(80), gramsEstimate: z.number().min(0).max(2000), gramsLow: z.number().min(0).max(2000), gramsHigh: z.number().min(0).max(3000) })).max(8),
      }),
    )
    .max(40),
});
export type MenuAnalysis = z.infer<typeof MenuAnalysis>;

export const MENU_SYSTEM = `You read restaurant menus (photos or pasted text) for a nutrition app.
- List the dishes. Copy nutrition values ONLY if they are printed on the menu for that dish ("printedNutrition"); otherwise null. Never invent official values.
- For each dish, list its likely main components with generic food-database search terms and a typical restaurant portion range in grams. These are estimates and will be labelled as such.`;
