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
  goal: TrainingGoal;
  likedSlugs?: readonly string[];
  excludedSlugs?: readonly string[];
}

const S = (pattern: string, role: Slot["role"], muscle?: string): Slot => (muscle ? { pattern, role, muscle } : { pattern, role });

export type TrainingGoal = "strength" | "hypertrophy" | "fat_loss" | "recomposition" | "endurance" | "general";

interface Rx {
  /** Sets for [new/beginner, intermediate/advanced]. */
  sets: [number, number];
  reps: [number, number];
  rir: number;
  restSec: number;
}

/**
 * How each goal is trained. Rep ranges and rests follow the ACSM progression
 * position stand (2009) and Schoenfeld et al. on volume (2017) and rest (2016):
 * heavy, low-rep, long-rest work for strength; more sets in the 6–15 range for
 * muscle; heavy work kept in a deficit to hold muscle, with denser sessions and
 * conditioning for fat loss.
 */
export const GOAL_TRAINING: Record<TrainingGoal, { main: Rx; secondary: Rx; accessory: Rx; maxAccessories: number; extraIsolation: boolean; finisherDays: number; finisherMinutes: [number, number]; why: string }> = {
  strength: { main: { sets: [3, 5], reps: [3, 5], rir: 2, restSec: 210 }, secondary: { sets: [3, 3], reps: [6, 8], rir: 2, restSec: 150 }, accessory: { sets: [2, 2], reps: [8, 12], rir: 2, restSec: 90 }, maxAccessories: 2, extraIsolation: false, finisherDays: 0, finisherMinutes: [0, 0], why: "Strength: heavy main lifts for 3–5 reps with long rests, a few supporting lifts, and little extra fatigue." },
  hypertrophy: { main: { sets: [3, 4], reps: [6, 10], rir: 2, restSec: 150 }, secondary: { sets: [3, 4], reps: [8, 12], rir: 1, restSec: 120 }, accessory: { sets: [3, 3], reps: [10, 15], rir: 1, restSec: 75 }, maxAccessories: 5, extraIsolation: true, finisherDays: 0, finisherMinutes: [0, 0], why: "Muscle: more weekly sets per muscle in the 6–15 rep range, extra isolation work, and taking sets close to failure." },
  fat_loss: { main: { sets: [3, 4], reps: [5, 8], rir: 2, restSec: 150 }, secondary: { sets: [3, 3], reps: [8, 12], rir: 2, restSec: 90 }, accessory: { sets: [2, 3], reps: [12, 15], rir: 1, restSec: 60 }, maxAccessories: 3, extraIsolation: false, finisherDays: 3, finisherMinutes: [10, 15], why: "Fat loss: keep lifting heavy so you hold on to muscle in a deficit, with shorter rests and a 10–15 minute conditioning finisher to burn more." },
  recomposition: { main: { sets: [3, 4], reps: [6, 10], rir: 2, restSec: 150 }, secondary: { sets: [3, 3], reps: [8, 12], rir: 1, restSec: 105 }, accessory: { sets: [2, 3], reps: [10, 15], rir: 1, restSec: 75 }, maxAccessories: 4, extraIsolation: true, finisherDays: 2, finisherMinutes: [10, 12], why: "Recomposition: muscle-building volume with two short conditioning finishers a week." },
  endurance: { main: { sets: [3, 3], reps: [6, 10], rir: 3, restSec: 120 }, secondary: { sets: [2, 3], reps: [10, 15], rir: 2, restSec: 75 }, accessory: { sets: [2, 2], reps: [12, 15], rir: 2, restSec: 60 }, maxAccessories: 2, extraIsolation: false, finisherDays: 0, finisherMinutes: [0, 0], why: "Endurance: full-body strength on alternate days to support running or riding, kept short so conditioning days stay fresh." },
  general: { main: { sets: [3, 3], reps: [6, 10], rir: 2, restSec: 120 }, secondary: { sets: [3, 3], reps: [8, 12], rir: 2, restSec: 90 }, accessory: { sets: [2, 2], reps: [10, 15], rir: 2, restSec: 60 }, maxAccessories: 3, extraIsolation: false, finisherDays: 1, finisherMinutes: [10, 15], why: "General fitness: a balance of strength, muscle and one conditioning finisher a week." },
};

/** Extra isolation work for muscle-focused goals, by day type. */
const EXTRA_ISOLATION: Record<string, Slot[]> = {
  full_body: [S("isolation", "accessory", "chest"), S("isolation", "accessory", "hamstrings")],
  upper: [S("isolation", "accessory", "chest"), S("isolation", "accessory", "lats")],
  lower: [S("isolation", "accessory", "glutes")],
  push: [S("isolation", "accessory", "triceps")],
  pull: [S("isolation", "accessory", "biceps")],
  legs: [S("isolation", "accessory", "glutes")],
};

export function goalTrainingRationale(goal: TrainingGoal): string {
  return GOAL_TRAINING[goal].why;
}

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

function prescriptionFor(ex: CatalogueExercise, role: Slot["role"], goal: TrainingGoal, experience: Experience): GeneratedPrescription {
  const loadProfile = (["barbell", "dumbbell", "machine", "cable", "bodyweight"].includes(ex.loadProfile) ? ex.loadProfile : "machine") as GeneratedPrescription["loadProfile"];
  const novice = experience === "new" || experience === "beginner";
  // Cardio "reps" are minutes: conditioning days are long and steady.
  if (ex.category === "cardio") return { scheme: "double_progression", sets: 1, repRange: { min: 30, max: 45 }, targetRir: 3, restSec: 0, loadProfile: "bodyweight" };
  const p = GOAL_TRAINING[goal];
  const rx = p[role];
  const sets = rx.sets[novice ? 0 : 1];
  // Novices on strength progress session to session on a fixed 5; trained lifters use the 3–5 range.
  if (role === "main" && goal === "strength" && ex.mechanics === "compound" && loadProfile === "barbell") {
    return { scheme: "linear", sets, repRange: novice ? { min: 5, max: 5 } : { min: rx.reps[0], max: rx.reps[1] }, targetRir: rx.rir, restSec: rx.restSec, loadProfile };
  }
  // Very low reps suit barbell lifts; on dumbbell or machine variants a beginner works in 5–8.
  if (role === "main" && goal === "strength" && novice) return { scheme: "double_progression", sets, repRange: { min: 5, max: 8 }, targetRir: rx.rir, restSec: rx.restSec, loadProfile };
  return { scheme: "double_progression", sets, repRange: { min: rx.reps[0], max: rx.reps[1] }, targetRir: rx.rir, restSec: rx.restSec, loadProfile };
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
    const profile = GOAL_TRAINING[input.goal];
    const type = dayKind(dayName);
    let slots = slotsForDay(dayName, di);
    if (profile.extraIsolation && type !== "conditioning") slots = [...slots, ...(EXTRA_ISOLATION[type] ?? [])];
    // Keep the goal's accessory budget, then the session-length budget.
    let accessories = 0;
    slots = slots.filter((sl) => sl.role !== "accessory" || type === "conditioning" || ++accessories <= profile.maxAccessories).slice(0, maxExercises + (profile.extraIsolation ? 2 : 0));
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
    // A conditioning finisher on the first N lifting days; its minutes are set aside before fitting the lifting.
    const liftingIndex = input.split.dayNames.slice(0, di + 1).filter((n) => dayKind(n) !== "conditioning").length - 1;
    const finisher = type !== "conditioning" && liftingIndex < profile.finisherDays ? pickFinisher(input.catalogue, equipment, excluded, di) : null;
    const finisherMin = finisher ? profile.finisherMinutes[1] : 0;
    const fitted = fitToTime(exercises, input.sessionMinutes - finisherMin);
    if (finisher) fitted.push({ exerciseId: finisher.id, slug: finisher.slug, name: finisher.name, role: "accessory", prescription: { scheme: "double_progression", sets: 1, repRange: { min: profile.finisherMinutes[0], max: profile.finisherMinutes[1] }, targetRir: 2, restSec: 0, loadProfile: "bodyweight" } });
    const cardioMinutes = fitted.filter((e) => input.catalogue.find((c) => c.id === e.exerciseId)?.category === "cardio").reduce((a, e) => a + e.prescription.repRange.max, 0);
    const lifting = fitted.filter((e) => input.catalogue.find((c) => c.id === e.exerciseId)?.category !== "cardio");
    return { name: dayName, weekday: input.split.weekdays[di] ?? null, exercises: fitted, estimatedMinutes: (lifting.length ? estimateMinutes(lifting.map((e) => e.prescription)) : 0) + cardioMinutes };
  });
}

function dayKind(dayName: string): string {
  const n = dayName.toLowerCase();
  if (n.includes("conditioning")) return "conditioning";
  if (n.includes("full body") || n.includes("strength")) return "full_body";
  for (const k of ["upper", "lower", "push", "pull", "legs"]) if (n.startsWith(k)) return k;
  return "full_body";
}

/** A cardio option the user has the equipment for, rotating across days for variety. */
function pickFinisher(catalogue: readonly CatalogueExercise[], equipment: Set<string>, excluded: Set<string>, dayIndex: number): CatalogueExercise | null {
  const options = catalogue.filter((e) => e.category === "cardio" && equipment.has(e.equipment) && !excluded.has(e.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
  return options.length ? options[dayIndex % options.length]! : null;
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
