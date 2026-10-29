import type { NutrientValues } from "../nutrition/nutrients";
import type { DayKey } from "../time";
import type { SetKind } from "../training/sets";
import { lbToKg } from "../units";
import { csvRecords } from "./csv";

/**
 * Importers for exports from other apps. They only parse and normalise; the
 * API decides how records are stored. Times in these exports carry no time
 * zone, so they are returned as local day + "HH:MM" for the caller to place
 * in the user's zone. Nothing is invented: unknown or unsupported rows are
 * skipped and reported as warnings.
 */

export type ImportSource = "strong" | "hevy" | "mfp_nutrition" | "mfp_measurements";

export interface ImportedSet {
  kind: SetKind;
  weightKg: number;
  reps: number;
  rpe: number | null;
}

export interface ImportedExercise {
  name: string;
  notes: string | null;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  /** Stable identity within the source export, for idempotent re-imports. */
  key: string;
  name: string;
  day: DayKey;
  time: string;
  durationSec: number | null;
  notes: string | null;
  exercises: ImportedExercise[];
}

export interface ImportedMeal {
  day: DayKey;
  meal: string;
  nutrients: NutrientValues;
  note: string | null;
}

export interface ImportedWeight {
  day: DayKey;
  kg: number;
}

export interface ParsedImport {
  source: ImportSource;
  workouts: ImportedWorkout[];
  meals: ImportedMeal[];
  weights: ImportedWeight[];
  warnings: string[];
  rowsRead: number;
}

export interface ImportOptions {
  /** Unit of weights in exports that don't say (Strong, MyFitnessPal). */
  weightUnit: "kg" | "lb";
}

export function detectImportSource(headers: readonly string[]): ImportSource | null {
  const h = new Set(headers.map((x) => x.toLowerCase()));
  if (h.has("exercise name") && h.has("set order")) return "strong";
  if (h.has("exercise_title") && h.has("set_index")) return "hevy";
  if (h.has("meal") && h.has("calories")) return "mfp_nutrition";
  if (h.has("date") && [...h].some((x) => x.startsWith("weight")) && !h.has("meal")) return "mfp_measurements";
  return null;
}

export function parseImport(text: string, opts: ImportOptions, source?: ImportSource): ParsedImport {
  const { headers, records } = csvRecords(text);
  const kind = source ?? detectImportSource(headers);
  if (!kind) throw new ImportFormatError("This file isn't a recognised export. Supported: Strong (CSV), Hevy (CSV), MyFitnessPal Nutrition and Measurement summaries (CSV).");
  const base = { source: kind, workouts: [], meals: [], weights: [], warnings: [] as string[], rowsRead: records.length };
  if (kind === "strong") return { ...base, ...parseStrong(records, opts) };
  if (kind === "hevy") return { ...base, ...parseHevy(records) };
  if (kind === "mfp_nutrition") return { ...base, ...parseMfpNutrition(records) };
  return { ...base, ...parseMfpMeasurements(records, headers, opts) };
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

/* ───────── helpers ───────── */

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-20 07:45:12", "2026-10-20T07:45", "20 Oct 2026, 07:45", "Oct 20, 2026 7:45 AM". */
export function parseLocalDateTime(s: string): { day: DayKey; time: string } | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${pad(Number(m[4]))}:${m[5]}` : "12:00" };
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/.exec(t);
  if (m && MONTHS[m[2]!.toLowerCase()]) return { day: `${m[3]}-${pad(MONTHS[m[2]!.toLowerCase()]!)}-${pad(Number(m[1]))}`, time: `${pad(Number(m[4]))}:${m[5]}` };
  m = /^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
  if (m && MONTHS[m[1]!.toLowerCase()]) {
    let h = Number(m[4]);
    if (m[6]?.toUpperCase() === "PM" && h < 12) h += 12;
    if (m[6]?.toUpperCase() === "AM" && h === 12) h = 0;
    return { day: `${m[3]}-${pad(MONTHS[m[1]!.toLowerCase()]!)}-${pad(Number(m[2]))}`, time: `${pad(h)}:${m[5]}` };
  }
  return null;
}

/** Strong durations: "1h 5m", "45m", "1h", "3600" (seconds). */
export function parseDuration(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const h = /(\d+)\s*h/.exec(t), m = /(\d+)\s*m/.exec(t), sec = /(\d+)\s*s/.exec(t);
  if (!h && !m && !sec) return null;
  return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function pushSet(map: Map<string, ImportedWorkout>, key: string, init: () => ImportedWorkout, exerciseName: string, exerciseNotes: string | null, set: ImportedSet) {
  let w = map.get(key);
  if (!w) map.set(key, (w = init()));
  let ex = w.exercises.at(-1);
  if (!ex || ex.name !== exerciseName) w.exercises.push((ex = { name: exerciseName, notes: exerciseNotes, sets: [] }));
  ex.sets.push(set);
}

/* ───────── Strong ───────── */

function parseStrong(records: Record<string, string>[], opts: ImportOptions) {
  const warnings: string[] = [];
  const map = new Map<string, ImportedWorkout>();
  let cardio = 0, unknown = 0;
  for (const r of records) {
    const when = parseLocalDateTime(r["Date"] ?? "");
    const exName = r["Exercise Name"] ?? "";
    if (!when || !exName) {
      unknown++;
      continue;
    }
    const order = (r["Set Order"] ?? "").trim();
    const kind: SetKind | null = /^\d+$/.test(order) ? "working" : order === "W" ? "warmup" : order === "D" ? "drop" : order === "F" ? "failure" : null;
    if (!kind) {
      unknown++;
      continue;
    }
    const reps = num(r["Reps"]);
    if (reps === null || reps <= 0) {
      if (num(r["Distance"]) || num(r["Seconds"])) cardio++;
      else unknown++;
      continue;
    }
    const w = num(r["Weight"]) ?? 0;
    const key = `${r["Date"]}|${r["Workout Name"] ?? ""}`;
    pushSet(map, key, () => ({ key, name: r["Workout Name"] || "Workout", day: when.day, time: when.time, durationSec: parseDuration(r["Duration"] ?? ""), notes: r["Workout Notes"] || null, exercises: [] }), exName, r["Notes"] || null, {
      kind,
      weightKg: round2(opts.weightUnit === "lb" ? lbToKg(w) : w),
      reps: Math.round(reps),
      rpe: rpeOrNull(num(r["RPE"])),
    });
  }
  if (cardio) warnings.push(`${plural(cardio, "cardio set (distance or time only) was", "cardio sets (distance or time only) were")} skipped; cardio logging isn't supported yet.`);
  if (unknown) warnings.push(`${plural(unknown, "row couldn't be read and was", "rows couldn't be read and were")} skipped.`);
  return { workouts: [...map.values()], warnings };
}

const rpeOrNull = (v: number | null) => (v !== null && v >= 1 && v <= 10 ? v : null);

/* ───────── Hevy ───────── */

function parseHevy(records: Record<string, string>[]) {
  const warnings: string[] = [];
  const map = new Map<string, ImportedWorkout>();
  let cardio = 0, unknown = 0;
  for (const r of records) {
    const start = parseLocalDateTime(r["start_time"] ?? "");
    const exName = r["exercise_title"] ?? "";
    if (!start || !exName) {
      unknown++;
      continue;
    }
    const reps = num(r["reps"]);
    if (reps === null || reps <= 0) {
      if (num(r["distance_km"]) || num(r["distance_miles"]) || num(r["duration_seconds"])) cardio++;
      else unknown++;
      continue;
    }
    const kg = num(r["weight_kg"]) ?? (num(r["weight_lbs"]) !== null ? lbToKg(num(r["weight_lbs"])!) : 0);
    const t = (r["set_type"] ?? "normal").toLowerCase();
    const kind: SetKind = t === "warmup" ? "warmup" : t === "dropset" ? "drop" : t === "failure" ? "failure" : "working";
    const end = parseLocalDateTime(r["end_time"] ?? "");
    const key = `${r["start_time"]}|${r["title"] ?? ""}`;
    pushSet(map, key, () => ({ key, name: r["title"] || "Workout", day: start.day, time: start.time, durationSec: end ? minutesBetween(start, end) * 60 : null, notes: r["description"] || null, exercises: [] }), exName, r["exercise_notes"] || null, {
      kind,
      weightKg: round2(kg),
      reps: Math.round(reps),
      rpe: rpeOrNull(num(r["rpe"])),
    });
  }
  if (cardio) warnings.push(`${plural(cardio, "cardio set (distance or time only) was", "cardio sets (distance or time only) were")} skipped; cardio logging isn't supported yet.`);
  if (unknown) warnings.push(`${plural(unknown, "row couldn't be read and was", "rows couldn't be read and were")} skipped.`);
  return { workouts: [...map.values()], warnings };
}

function minutesBetween(a: { day: string; time: string }, b: { day: string; time: string }): number {
  const toMin = (x: { day: string; time: string }) => Date.parse(`${x.day}T${x.time}:00Z`) / 60000;
  const d = toMin(b) - toMin(a);
  return d > 0 && d < 24 * 60 ? d : 0;
}

/* ───────── MyFitnessPal ───────── */

const MFP_COLUMNS: [string, keyof NutrientValues][] = [
  ["Calories", "energyKcal"],
  ["Protein (g)", "proteinG"],
  ["Carbohydrates (g)", "carbsG"],
  ["Fat (g)", "fatG"],
  ["Fiber", "fiberG"],
  ["Sugar", "sugarG"],
  ["Saturated Fat", "saturatedFatG"],
  ["Polyunsaturated Fat", "polyunsaturatedFatG"],
  ["Monounsaturated Fat", "monounsaturatedFatG"],
  ["Trans Fat", "transFatG"],
  ["Cholesterol", "cholesterolMg"],
  ["Sodium (mg)", "sodiumMg"],
  ["Potassium", "potassiumMg"],
  // Vitamin and mineral columns in this export are % of daily value, not amounts: not imported.
];

function parseMfpNutrition(records: Record<string, string>[]) {
  const warnings: string[] = [];
  const byKey = new Map<string, ImportedMeal>();
  let skipped = 0;
  for (const r of records) {
    const day = parseLocalDateTime(r["Date"] ?? "")?.day;
    const kcal = num(r["Calories"]);
    if (!day || kcal === null) {
      skipped++;
      continue;
    }
    const meal = normalizeMeal(r["Meal"] ?? "");
    const key = `${day}|${meal}`;
    const existing = byKey.get(key);
    const n: NutrientValues = {};
    for (const [col, k] of MFP_COLUMNS) {
      const v = num(r[col]);
      if (v !== null) n[k] = v;
    }
    if (existing) {
      // Same meal listed twice: add known values; a value missing on either side stays missing.
      for (const [, k] of MFP_COLUMNS) {
        const a = existing.nutrients[k], b = n[k];
        existing.nutrients[k] = typeof a === "number" && typeof b === "number" ? a + b : null;
      }
    } else byKey.set(key, { day, meal, nutrients: n, note: r["Note"] || null });
  }
  if (skipped) warnings.push(`${plural(skipped, "row without a date or calories was", "rows without a date or calories were")} skipped.`);
  warnings.push("MyFitnessPal exports totals per meal, not individual foods, so each meal is imported as one entry.");
  return { meals: [...byKey.values()], warnings };
}

export function normalizeMeal(s: string): string {
  const t = s.trim().toLowerCase();
  if (t.startsWith("breakfast")) return "breakfast";
  if (t.startsWith("lunch")) return "lunch";
  if (t.startsWith("dinner")) return "dinner";
  if (t.startsWith("snack")) return "snacks";
  return t.slice(0, 40) || "snacks";
}

function parseMfpMeasurements(records: Record<string, string>[], headers: string[], opts: ImportOptions) {
  const col = headers.find((h) => h.toLowerCase().startsWith("weight"))!;
  const unit = /\(kg\)/i.test(col) ? "kg" : /\(lbs?\)/i.test(col) ? "lb" : opts.weightUnit;
  const weights: ImportedWeight[] = [];
  let skipped = 0;
  for (const r of records) {
    const day = parseLocalDateTime(r["Date"] ?? "")?.day;
    const v = num(r[col]);
    if (!day || v === null || v <= 0) {
      skipped++;
      continue;
    }
    weights.push({ day, kg: round2(unit === "lb" ? lbToKg(v) : v) });
  }
  return { weights, warnings: skipped ? [`${plural(skipped, "row without a date or weight was", "rows without a date or weight were")} skipped.`] : [] };
}

/* ───────── exercise names ───────── */

const EQUIPMENT: [RegExp, string][] = [
  [/smith machine/i, "smith machine"],
  [/barbell/i, "barbell"],
  [/dumbbell/i, "dumbbell"],
  [/cable/i, "cable"],
  [/machine/i, "machine"],
  [/kettlebell/i, "kettlebell"],
  [/ez ?bar/i, "ez bar"],
  [/band/i, "band"],
  [/body ?weight/i, ""],
  [/weighted/i, "weighted"],
  [/assisted/i, "assisted"],
];

/**
 * Search terms for an exercise name from another app, best first.
 * "Bench Press (Barbell)" → ["barbell bench press", "bench press", "bench press (barbell)"].
 */
export function exerciseQueries(name: string): string[] {
  const raw = name.trim();
  const paren = /\(([^)]*)\)/.exec(raw)?.[1] ?? "";
  const base = raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const equip = EQUIPMENT.find(([re]) => re.test(paren))?.[1];
  const out = [equip ? `${equip} ${base}` : null, base, raw.toLowerCase()].filter((x): x is string => !!x && x.trim().length > 0);
  return [...new Set(out.map((x) => x.trim()))];
}

const EQUIPMENT_WORDS = ["barbell", "dumbbell", "cable", "machine", "smith", "kettlebell", "band"];

/**
 * Strict check that a catalogue exercise is the one an imported name means:
 * every real word of the imported name appears in the catalogue name, and the
 * equipment (if the import states it) doesn't conflict. A wrong match would
 * mislabel history, so anything uncertain becomes a custom exercise instead.
 */
export function acceptsExerciseMatch(importName: string, catalogueName: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 1 && !["the", "and", "with", "on", "of"].includes(w));
  const stemW = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  const base = words(importName.replace(/\([^)]*\)/g, " ")).map(stemW);
  const target = words(catalogueName).map(stemW);
  if (!base.length || !base.every((w) => target.includes(w))) return false;
  const stated = EQUIPMENT_WORDS.find((e) => (/\(([^)]*)\)/.exec(importName)?.[1] ?? "").toLowerCase().includes(e));
  const named = EQUIPMENT_WORDS.filter((e) => target.includes(e));
  return !stated || named.length === 0 || named.includes(stated);
}
