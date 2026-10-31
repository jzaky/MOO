import type { PortionDto } from "@stoke/contracts";
import { nutrientsForPortion, type PortionInput } from "@stoke/core";
import { defaultMealForNow, logFood, logWater, logWeight } from "../../lib/data";
import type { Exercise, Food } from "../../lib/types";
import { t } from "../../i18n";
import { addExercise, addSet, getActiveWorkout, removeSet, updateSet } from "../workout/store";

/** What /v1/log/parse returns: a DRAFT the user confirms. Nothing is written until commit. */
export interface FoodDraftItem {
  parsed: { name: string; quantity: number; quantityAssumed: boolean };
  candidates: { food: Food; portion: PortionDto | null }[];
  suggestion: { food: Food; portion: PortionDto | null } | null;
}
export type Draft =
  | { kind: "food"; parser: string; meal: string | null; items: FoodDraftItem[]; issues: string[] }
  | { kind: "exercise"; parser: string; entries: { parsed: { exerciseName: string; sets: number; reps: number | null; weightKg: number | null }; matches: { id: string; name: string }[] }[]; issues: string[] }
  | { kind: "body_weight"; parser: string; weightKg: number; issues: string[] }
  | { kind: "water"; parser: string; ml: number; issues: string[] }
  | { kind: "unrecognized"; parser: string; issues: string[] };

export type CommandIntent = { kind: "ask"; question: string } | { kind: "start"; query: string } | { kind: "log"; text: string };

// Question openers in English and Arabic. Arabic has no \b in JS regexes, so a following space (or end) delimits.
const ASK_OPENERS = /^(?:how|what|what's|whats|why|should|shall|can|could|is|am|are|do|does|did|when|which|where|will|would|tell me|explain|help|كيف|ماذا|ما|لماذا|هل|متى|أين|اين|ساعدني)(?:\s|$|')/i;
const START = /^(?:start|begin|let'?s do|ابدأ|ابدا)(?:\s+(?:my|the|a|an|today'?s|تمرين))?(?:\s+(.*?))?\s*$/i;

/**
 * Decide what a command-bar entry is, deterministically and offline:
 * a question goes to the coach, "start …" starts a workout, anything else is parsed as a log.
 */
export function intentOf(raw: string): CommandIntent {
  const text = raw.trim().replace(/\s+/g, " ");
  // "can of tuna", "can coke" are food, not questions.
  const foodCan = /^(?:a\s+)?cans?\s+(?:of\s+)?\S/i.test(text) && !/[?؟]$/.test(text) && !/^can\s+(?:i|you|we)\s/i.test(text);
  if (!foodCan && (/[?؟]$/.test(text) || ASK_OPENERS.test(text))) return { kind: "ask", question: text };
  const m = START.exec(text);
  if (m) return { kind: "start", query: (m[1] ?? "").replace(/\s*(?:workout|session|training|تمرين)$/i, "").trim() };
  return { kind: "log", text };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Pick the program day a "start …" refers to. An empty or generic query ("start workout",
 * "start next") means the next one in rotation; otherwise the best name match, or null if none fits.
 */
export function matchWorkout<D extends { id: string; name: string }>(query: string, days: D[], next: D | null): D | null {
  const q = norm(query);
  if (!q || /^(?:next|today|workout|session|التالي|اليوم)$/.test(q)) return next ?? days[0] ?? null;
  const exact = days.find((d) => norm(d.name) === q);
  if (exact) return exact;
  const words = q.split(" ");
  let best: D | null = null;
  let bestScore = 0;
  for (const d of days) {
    const name = norm(d.name);
    const nameWords = name.split(" ");
    let score = name.includes(q) ? words.length + 1 : 0;
    for (const w of words) if (nameWords.includes(w)) score += 1;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  // Require every query word to appear (or the whole query as a substring) so "start legs" never picks "Upper A".
  return bestScore >= words.length ? best : null;
}

/** Nutrients for one candidate, with the same core code the server uses. Null when the portion is unknown. */
export function candidateNutrients(c: { food: Food; portion: PortionDto | null }) {
  if (!c.portion) return null;
  const f = c.food;
  return nutrientsForPortion({ baseUnit: f.baseUnit, per100: f.per100, servings: f.servings.map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount })), densityGPerMl: f.densityGPerMl }, c.portion as PortionInput).nutrients;
}

/** The candidate pre-selected for an item: the server's suggestion only; look-alikes must be chosen. */
export function defaultPick(draft: Draft, i: number, chosen: Record<number, number>): number {
  return chosen[i] ?? (draft.kind === "food" && draft.items[i]?.suggestion ? 0 : -1);
}

/** Whether every included food item has a chosen food with an amount. */
export function foodStatus(draft: Draft, chosen: Record<number, number>, off: Record<number, boolean>) {
  if (draft.kind !== "food") return { included: 0, needsAmount: 0 };
  const included = draft.items.filter((_, i) => !off[i]).length;
  const needsAmount = draft.items.filter((it, i) => !off[i] && !it.candidates[defaultPick(draft, i, chosen)]?.portion).length;
  return { included, needsAmount };
}

export function canCommit(draft: Draft | null, chosen: Record<number, number>, off: Record<number, boolean>): boolean {
  if (!draft || draft.kind === "unrecognized") return false;
  if (draft.kind !== "food") return true;
  const s = foodStatus(draft, chosen, off);
  return s.included > 0 && s.needsAmount === 0;
}

/** Write a confirmed draft (optimistically, via the outbox). Returns an error message, or null on success. */
export function commitDraft(draft: Draft, day: string, chosen: Record<number, number>, off: Record<number, boolean>): string | null {
  if (draft.kind === "food") {
    const meal = draft.meal ?? defaultMealForNow();
    draft.items.forEach((it, i) => {
      if (off[i]) return;
      const c = it.candidates[defaultPick(draft, i, chosen)];
      // Only the chosen food's own portion; never another candidate's.
      if (c?.portion) logFood({ food: c.food, portion: c.portion, day, meal });
    });
  } else if (draft.kind === "body_weight") logWeight(day, draft.weightKg);
  else if (draft.kind === "water") logWater(day, draft.ml);
  else if (draft.kind === "exercise") {
    if (!getActiveWorkout()) return t("Start a workout first; these sets will be added to it.");
    for (const e of draft.entries) {
      const m = e.matches[0];
      if (!m) continue;
      addExercise({ id: m.id, name: m.name, loadProfile: "machine", equipment: "", primaryMuscles: [] } as unknown as Exercise);
      const rowId = getActiveWorkout()!.exercises.at(-1)!.id;
      for (let s = getActiveWorkout()!.exercises.at(-1)!.sets.length; s < e.parsed.sets; s++) addSet(rowId);
      const row = getActiveWorkout()!.exercises.find((x) => x.id === rowId)!;
      // Keep exactly the spoken number of sets, prefilled with the spoken load and reps (not yet marked done).
      row.sets.slice(0, e.parsed.sets).forEach((set) => updateSet(rowId, set.id, { ...(e.parsed.weightKg != null ? { weightKg: e.parsed.weightKg } : {}), ...(e.parsed.reps != null ? { reps: e.parsed.reps } : {}) }));
      row.sets.slice(e.parsed.sets).forEach((set) => removeSet(rowId, set.id));
    }
  } else return t("Couldn't understand that.");
  return null;
}
