import type { Experience, SplitSuggestion } from "./splits";

/**
 * Deterministic program generator. Picks exercises for slot templates from
 * the catalogue given equipment, experience, preferences and session length.
 * The coach/LLM may propose edits on top, but the baseline is reproducible
 * and testable.
 */

export interface CatalogueExercise {
  id: string;
  slug: string;
  name: string;
  pattern: string;
  primaryMuscles: readonly string[];
  equipment: string;
  mechanics: "compound" | "isolation" | string;
  difficulty: "beginner" | "intermediate" | "advanced" | string;
  category: string;
  loadProfile: string;
}

export interface Slot {
  pattern: string;
  muscle?: string;
  role: "main" | "secondary" | "accessory";
}

export interface GeneratedPrescription {
  scheme: "double_progression" | "linear";
  sets: number;
  repRange: { min: number; max: number };
  targetRir: number;
  restSec: number;
  loadProfile: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight";
}

export interface GeneratedDay {
  name: string;
  weekday: number | null;
  exercises: { exerciseId: string; slug: string; name: string; role: Slot["role"]; prescription: GeneratedPrescription }[];
  estimatedMinutes: number;
}

export interface GeneratorInput {
  split: SplitSuggestion;
  catalogue: readonly CatalogueExercise[];
  equipment: readonly string[];
  experience: Experience;
  sessionMinutes: number;
  goal: "strength" | "hypertrophy" | "general";
  likedSlugs?: readonly string[];
  excludedSlugs?: readonly string[];
}

const S = (pattern: string, role: Slot["role"], muscle?: string): Slot => (muscle ? { pattern, role, muscle } : { pattern, role });

export const DAY_SLOTS: Record<string, Slot[]> = {
  full_body_a: [S("squat", "main"), S("horizontal_push", "main"), S("horizontal_pull", "secondary"), S("hinge", "secondary"), S("vertical_pull", "accessory"), S("isolation", "accessory", "side_delts"), S("core", "accessory")],
  full_body_b: [S("hinge", "main"), S("vertical_push", "main"), S("vertical_pull", "secondary"), S("lunge", "secondary"), S("horizontal_pull", "accessory"), S("isolation", "accessory", "biceps"), S("isolation", "accessory", "triceps")],
  upper: [S("horizontal_push", "main"), S("horizontal_pull", "main"), S("vertical_push", "secondary"), S("vertical_pull", "secondary"), S("isolation", "accessory", "side_delts"), S("isolation", "accessory", "biceps"), S("isolation", "accessory", "triceps")],
  lower: [S("squat", "main"), S("hinge", "main"), S("lunge", "secondary"), S("isolation", "accessory", "hamstrings"), S("isolation", "accessory", "quads"), S("isolation", "accessory", "calves"), S("core", "accessory")],
  push: [S("horizontal_push", "main"), S("vertical_push", "secondary"), S("horizontal_push", "secondary", "chest"), S("isolation", "accessory", "side_delts"), S("isolation", "accessory", "triceps"), S("isolation", "accessory", "chest")],
  pull: [S("vertical_pull", "main"), S("horizontal_pull", "secondary"), S("horizontal_pull", "secondary", "upper_back"), S("isolation", "accessory", "rear_delts"), S("isolation", "accessory", "biceps"), S("isolation", "accessory", "lats")],
  legs: [S("squat", "main"), S("hinge", "secondary"), S("squat", "secondary", "quads"), S("isolation", "accessory", "hamstrings"), S("isolation", "accessory", "quads"), S("isolation", "accessory", "calves")],
  conditioning: [S("cardio", "main"), S("core", "accessory"), S("carry", "accessory")],
};

export function slotsForDay(dayName: string, index: number): Slot[] {
  const n = dayName.toLowerCase();
  if (n.includes("conditioning")) return DAY_SLOTS.conditioning!;
  if (n.includes("full body") || n.includes("strength")) return index % 2 === 0 ? DAY_SLOTS.full_body_a! : DAY_SLOTS.full_body_b!;
  if (n.startsWith("upper")) return DAY_SLOTS.upper!;
  if (n.startsWith("lower")) return DAY_SLOTS.lower!;
  if (n.startsWith("push")) return DAY_SLOTS.push!;
  if (n.startsWith("pull")) return DAY_SLOTS.pull!;
  if (n.startsWith("legs")) return DAY_SLOTS.legs!;
  return DAY_SLOTS.full_body_a!;
}

const DIFFICULTY_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const EXPERIENCE_RANK: Record<Experience, number> = { new: 0, beginner: 0, intermediate: 1, advanced: 2 };

function prescriptionFor(ex: CatalogueExercise, role: Slot["role"], goal: GeneratorInput["goal"], experience: Experience): GeneratedPrescription {
  const loadProfile = (["barbell", "dumbbell", "machine", "cable", "bodyweight"].includes(ex.loadProfile) ? ex.loadProfile : "machine") as GeneratedPrescription["loadProfile"];
  const novice = experience === "new" || experience === "beginner";
  if (ex.category === "cardio") return { scheme: "double_progression", sets: 1, repRange: { min: 15, max: 30 }, targetRir: 3, restSec: 0, loadProfile: "bodyweight" };
  if (role === "main" && goal === "strength" && ex.mechanics === "compound" && loadProfile === "barbell") {
    return { scheme: "linear", sets: novice ? 3 : 4, repRange: { min: 5, max: 5 }, targetRir: 2, restSec: 180, loadProfile };
  }
  if (role === "main") return { scheme: "double_progression", sets: novice ? 3 : 4, repRange: { min: 6, max: 10 }, targetRir: 2, restSec: 150, loadProfile };
  if (role === "secondary") return { scheme: "double_progression", sets: 3, repRange: { min: 8, max: 12 }, targetRir: 2, restSec: 120, loadProfile };
  return { scheme: "double_progression", sets: novice ? 2 : 3, repRange: { min: 10, max: 15 }, targetRir: 1, restSec: 75, loadProfile };
}

/** Rough session duration: working time + rest per set + 5 min warm-up. */
export function estimateMinutes(ps: readonly { sets: number; restSec: number }[]): number {
  let sec = 300;
  for (const p of ps) sec += p.sets * (45 + p.restSec);
  return Math.round(sec / 60);
}

export function generateProgram(input: GeneratorInput): GeneratedDay[] {
  const equipment = new Set(input.equipment);
  equipment.add("bodyweight");
  const excluded = new Set(input.excludedSlugs ?? []);
  const liked = new Set(input.likedSlugs ?? []);
  const maxDifficulty = EXPERIENCE_RANK[input.experience];
  const usedByDayType = new Map<string, Set<string>>();
  const usedAcrossProgram = new Map<string, number>();
  const maxExercises = Math.max(3, Math.min(8, Math.floor(input.sessionMinutes / 9)));

  return input.split.dayNames.map((dayName, di) => {
    const slots = slotsForDay(dayName, di).slice(0, maxExercises);
    const usedToday = new Set<string>();
    const dayType = dayName.replace(/\s+[AB]$/, "");
    const usedSameType = usedByDayType.get(dayType) ?? new Set<string>();
    const exercises: GeneratedDay["exercises"] = [];
    for (const slot of slots) {
      const candidates = input.catalogue.filter(
        (e) =>
          e.pattern === slot.pattern &&
          (!slot.muscle || e.primaryMuscles.includes(slot.muscle)) &&
          equipment.has(e.equipment === "smith_machine" ? "smith_machine" : e.equipment) &&
          !excluded.has(e.slug) &&
          !usedToday.has(e.slug) &&
          (DIFFICULTY_RANK[e.difficulty] ?? 1) <= maxDifficulty + (slot.role === "accessory" ? 1 : 0) &&
          (slot.role !== "main" || e.mechanics === "compound" || e.category === "cardio"),
      );
      if (!candidates.length) continue;
      const score = (e: CatalogueExercise) =>
        (liked.has(e.slug) ? 10 : 0) -
        (usedSameType.has(e.slug) ? 4 : 0) - // vary A/B days of the same type
        (usedAcrossProgram.get(e.slug) ?? 0) * 1.5 +
        (slot.role === "main" && e.equipment === "barbell" && maxDifficulty >= 1 ? 2 : 0) +
        (slot.role !== "main" && (e.equipment === "machine" || e.equipment === "cable") ? 1 : 0) +
        (input.experience === "new" && e.equipment === "machine" ? 1.5 : 0);
      const pick = [...candidates].sort((a, b) => score(b) - score(a) || a.slug.localeCompare(b.slug))[0]!;
      usedToday.add(pick.slug);
      usedSameType.add(pick.slug);
      usedAcrossProgram.set(pick.slug, (usedAcrossProgram.get(pick.slug) ?? 0) + 1);
      exercises.push({ exerciseId: pick.id, slug: pick.slug, name: pick.name, role: slot.role, prescription: prescriptionFor(pick, slot.role, input.goal, input.experience) });
    }
    usedByDayType.set(dayType, usedSameType);
    const fitted = fitToTime(exercises, input.sessionMinutes);
    return { name: dayName, weekday: input.split.weekdays[di] ?? null, exercises: fitted, estimatedMinutes: estimateMinutes(fitted.map((e) => e.prescription)) };
  });
}

/**
 * Shorten a session to fit a time budget while preserving the most important
 * work: drop accessories from the end first, then trim sets (never below 2 on
 * main lifts), then drop secondaries.
 */
export function fitToTime<T extends { role: Slot["role"]; prescription: { sets: number; restSec: number } }>(exercises: readonly T[], minutes: number): T[] {
  let list = exercises.map((e) => ({ ...e, prescription: { ...e.prescription } }));
  const total = () => estimateMinutes(list.map((e) => e.prescription));
  for (const role of ["accessory", "secondary"] as const) {
    while (total() > minutes) {
      const idx = list.map((e) => e.role).lastIndexOf(role);
      if (idx < 0) break;
      const ex = list[idx]!;
      if (ex.prescription.sets > 2) ex.prescription.sets -= 1;
      else list = list.filter((_, i) => i !== idx);
    }
  }
  while (total() > minutes) {
    const longest = list.filter((e) => e.prescription.sets > 2).sort((a, b) => b.prescription.sets - a.prescription.sets)[0];
    if (!longest) break;
    longest.prescription.sets -= 1;
  }
  return list;
}
