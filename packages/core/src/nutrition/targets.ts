import type { Experience } from "../training/splits";

/**
 * Starting nutrition targets. These are ESTIMATES used to seed a plan; the
 * adaptive engine (adaptive.ts) refines them from logged intake and weight
 * trend once enough data exists.
 *
 * References:
 *  - Mifflin-St Jeor (1990) resting energy expenditure.
 *  - Katch-McArdle when a body-fat estimate is supplied.
 *  - Protein 1.6–2.2 g/kg for resistance-trained people (Morton et al. 2018;
 *    ISSN position stand 2017); higher end during energy deficit.
 */

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";
export type PrimaryGoal =
  | "lose_fat"
  | "build_muscle"
  | "maintain"
  | "recomposition"
  | "strength"
  | "general_fitness"
  | "endurance";

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export interface BodyInputs {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number | null;
}

export function validateBody(b: BodyInputs): void {
  if (!(b.ageYears >= 13 && b.ageYears <= 100)) throw new RangeError("Age must be between 13 and 100");
  if (!(b.heightCm >= 100 && b.heightCm <= 250)) throw new RangeError("Height must be between 100 and 250 cm");
  if (!(b.weightKg >= 30 && b.weightKg <= 350)) throw new RangeError("Weight must be between 30 and 350 kg");
  if (b.bodyFatPct != null && !(b.bodyFatPct >= 3 && b.bodyFatPct <= 70)) throw new RangeError("Body fat must be between 3% and 70%");
}

export function mifflinStJeor(b: BodyInputs): number {
  const base = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.ageYears;
  return b.sex === "male" ? base + 5 : base - 161;
}

export function katchMcArdle(weightKg: number, bodyFatPct: number): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lbm;
}

export function estimateBmr(b: BodyInputs): { kcal: number; method: "mifflin_st_jeor" | "katch_mcardle" } {
  validateBody(b);
  if (b.bodyFatPct != null) return { kcal: katchMcArdle(b.weightKg, b.bodyFatPct), method: "katch_mcardle" };
  return { kcal: mifflinStJeor(b), method: "mifflin_st_jeor" };
}

export function estimateTdee(b: BodyInputs, activity: ActivityLevel): number {
  return estimateBmr(b).kcal * ACTIVITY_MULTIPLIER[activity];
}

export interface TargetOptions {
  goal: PrimaryGoal;
  /**
   * Desired weekly rate of change as a fraction of body weight
   * (e.g. -0.005 = lose 0.5 %/week). Clamped to safe bounds below.
   */
  weeklyRatePct?: number;
  /** Fraction of calories from fat (default: the goal's). */
  fatShare?: number;
  /** Training experience: sets how big a muscle-gain surplus is useful. */
  experience?: Experience;
  /** Lower-priority goals; they adjust, not replace, the primary goal. */
  secondaryGoals?: readonly PrimaryGoal[];
  /** Planned training days per week; endurance carbohydrate scales with it. */
  trainingDaysPerWeek?: number;
}

/** Bounds on weekly body-weight change (fraction of body weight). */
export const RATE_LIMITS = { minLoss: -0.01, maxGain: 0.005 } as const;
/** Absolute calorie floors below which we refuse to set a target without clinical supervision. */
export const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };
/** Never prescribe a deficit larger than this fraction of estimated TDEE. */
export const MAX_DEFICIT_FRACTION = 0.25;
/** Energy density of body-mass change used for planning (kcal per kg). Approximate. */
export const KCAL_PER_KG_BODY_MASS = 7700;

/**
 * What each goal asks of the diet. Ranges follow the ISSN position stands on
 * protein (2017) and diets/body composition (2017), Morton et al. 2018, and
 * ACSM/AND/DC sports nutrition (2016) for endurance carbohydrate.
 */
interface GoalNutrition {
  /** Weekly change as a fraction of body weight; muscle gain depends on training age. */
  rate: number | Record<Experience, number>;
  proteinGPerKg: number;
  fatShare: number;
  /** Carbohydrate the goal should not drop below, g/kg (fat gives way first). */
  carbFloorGPerKg: number;
  why: string;
}

export const GOAL_NUTRITION: Record<PrimaryGoal, GoalNutrition> = {
  lose_fat: { rate: -0.005, proteinGPerKg: 2.2, fatShare: 0.25, carbFloorGPerKg: 2, why: "Fat loss: about 0.5% of body weight a week. Protein is high (2.2 g/kg) to keep muscle in a deficit; carbs stay high enough to train well." },
  build_muscle: { rate: { new: 0.005, beginner: 0.005, intermediate: 0.0025, advanced: 0.0015 }, proteinGPerKg: 1.8, fatShare: 0.25, carbFloorGPerKg: 4, why: "Muscle gain: a small surplus sized to training experience, so most of the gain is muscle. Protein 1.8 g/kg; plenty of carbs to fuel training volume." },
  recomposition: { rate: -0.0015, proteinGPerKg: 2.2, fatShare: 0.25, carbFloorGPerKg: 3, why: "Recomposition: just under maintenance, with high protein (2.2 g/kg) so you can lose fat and build muscle slowly at the same time." },
  strength: { rate: 0.001, proteinGPerKg: 1.8, fatShare: 0.27, carbFloorGPerKg: 3, why: "Strength: around maintenance with a small surplus. Protein 1.8 g/kg and at least 3 g/kg carbs for heavy sessions." },
  endurance: { rate: 0, proteinGPerKg: 1.6, fatShare: 0.22, carbFloorGPerKg: 5, why: "Endurance: maintenance calories with carbohydrate first (5–6 g/kg) to fuel long and hard sessions; protein 1.6 g/kg for recovery." },
  general_fitness: { rate: 0, proteinGPerKg: 1.6, fatShare: 0.3, carbFloorGPerKg: 2.5, why: "General fitness: maintenance calories and a balanced split, with protein 1.6 g/kg." },
  maintain: { rate: 0, proteinGPerKg: 1.6, fatShare: 0.3, carbFloorGPerKg: 2.5, why: "Maintain: calories at maintenance and a balanced split, with protein 1.6 g/kg to keep the muscle you have." },
};

export interface NutritionTargets {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  estimatedTdeeKcal: number;
  bmrKcal: number;
  bmrMethod: "mifflin_st_jeor" | "katch_mcardle";
  weeklyRatePct: number;
  /** Human-readable notes about clamping or safety adjustments. */
  notes: string[];
  /** Why the numbers are what they are, for this goal (shown to the user). */
  rationale: string[];
  /** Always "estimated" for generated targets; becomes "adapted" after the adaptive engine runs. */
  basis: "estimated";
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function generateTargets(body: BodyInputs, activity: ActivityLevel, opts: TargetOptions): NutritionTargets {
  const notes: string[] = [];
  const bmr = estimateBmr(body);
  const tdee = bmr.kcal * ACTIVITY_MULTIPLIER[activity];

  const g = GOAL_NUTRITION[opts.goal];
  const secondary = new Set(opts.secondaryGoals ?? []);
  const rationale = [g.why];
  let defaultRate = typeof g.rate === "number" ? g.rate : g.rate[opts.experience ?? "intermediate"];
  // Gaining while also wanting to lose fat: a leaner surplus. Losing while also chasing muscle or strength: a gentler deficit.
  if (defaultRate > 0 && secondary.has("lose_fat")) {
    defaultRate /= 2;
    rationale.push("Surplus halved because losing fat is also a goal.");
  }
  if (defaultRate < 0 && (secondary.has("build_muscle") || secondary.has("strength"))) {
    defaultRate = Math.max(defaultRate, -0.004);
    rationale.push("Deficit kept moderate so strength and muscle can keep progressing.");
  }
  let rate = opts.weeklyRatePct ?? defaultRate;
  if (rate < RATE_LIMITS.minLoss) {
    notes.push("Requested loss rate exceeded 1% of body weight per week and was limited to 1%.");
    rate = RATE_LIMITS.minLoss;
  }
  if (rate > RATE_LIMITS.maxGain) {
    notes.push("Requested gain rate exceeded 0.5% of body weight per week and was limited to 0.5%.");
    rate = RATE_LIMITS.maxGain;
  }

  const dailyDelta = (rate * body.weightKg * KCAL_PER_KG_BODY_MASS) / 7;
  let energy = tdee + dailyDelta;

  if (energy < tdee * (1 - MAX_DEFICIT_FRACTION)) {
    energy = tdee * (1 - MAX_DEFICIT_FRACTION);
    notes.push("Deficit limited to 25% of estimated maintenance.");
  }
  const floor = CALORIE_FLOOR[body.sex];
  if (energy < floor) {
    energy = Math.min(floor, tdee);
    notes.push(`Target raised to ${Math.round(energy)} kcal; lower intakes should be supervised by a clinician.`);
  }
  energy = roundTo(energy, 10);

  // Protein on body weight; for higher body-fat users scale on an adjusted weight
  // so targets do not become unrealistic.
  let proteinBasisKg = body.weightKg;
  if (body.bodyFatPct != null && body.bodyFatPct > 30) {
    proteinBasisKg = body.weightKg * (1 - body.bodyFatPct / 100) / 0.75;
    notes.push("Protein based on estimated lean mass because body fat is above 30%.");
  } else {
    const bmi = body.weightKg / (body.heightCm / 100) ** 2;
    if (bmi > 30) {
      // Weight at BMI 27 as a pragmatic reference when body fat is unknown.
      proteinBasisKg = 27 * (body.heightCm / 100) ** 2;
      notes.push("Protein based on a reference weight because BMI is above 30.");
    }
  }
  let proteinPerKg = g.proteinGPerKg;
  // Any body-composition secondary goal (gain muscle, lose fat, recomp) keeps protein at 2.0 g/kg or more.
  if (secondary.has("build_muscle") || secondary.has("recomposition") || secondary.has("lose_fat")) proteinPerKg = Math.max(proteinPerKg, 2.0);
  let proteinG = roundTo(proteinBasisKg * proteinPerKg, 5);

  // Endurance carbohydrate rises with training load (ACSM 2016: 5–7 g/kg for 1 h/day of moderate-to-hard work).
  const days = opts.trainingDaysPerWeek ?? 3;
  const carbFloorPerKg = opts.goal === "endurance" ? (days >= 5 ? 6 : 5) : g.carbFloorGPerKg;
  const carbFloorG = carbFloorPerKg * body.weightKg;
  // Rounded up so the floor is never undercut by rounding.
  const fatFloor = Math.ceil(Math.max(0.6 * body.weightKg, (energy * 0.2) / 9) / 5) * 5;

  const fatShare = Math.min(Math.max(opts.fatShare ?? g.fatShare, 0.2), 0.4);
  let fatG = roundTo(Math.max((energy * fatShare) / 9, fatFloor), 5);
  let carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
  if (carbsG < carbFloorG && fatG > fatFloor) {
    // The goal's carbohydrate comes before extra fat: trim fat towards its floor (20% of energy, 0.6 g/kg).
    fatG = Math.max(fatFloor, roundTo(fatG - ((carbFloorG - carbsG) * 4) / 9, 5));
    carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
  }
  if (carbsG < 50) {
    // Very low energy targets: keep a minimum carbohydrate allowance, giving up some protein if needed.
    proteinG = roundTo(Math.max(1.4 * proteinBasisKg, (energy - fatG * 9 - 50 * 4) / 4), 5);
    carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
    notes.push("Protein reduced to keep a minimum carbohydrate allowance at this energy level.");
  }
  carbsG = Math.max(0, roundTo(carbsG, 5));
  if (carbsG < carbFloorG - 25) rationale.push(`Carbs are ${(carbsG / body.weightKg).toFixed(1)} g/kg, below the ${carbFloorPerKg} g/kg this goal prefers at these calories; on long or hard days, eat more carbs.`);
  rationale.push(`${Math.round(proteinG)} g protein (${(proteinG / body.weightKg).toFixed(1)} g/kg body weight), ${Math.round(fatG)} g fat (${Math.round(((fatG * 9) / energy) * 100)}% of calories), ${Math.round(carbsG)} g carbs (${(carbsG / body.weightKg).toFixed(1)} g/kg).`);

  // 14 g fibre per 1000 kcal (Dietary Guidelines for Americans).
  const fiberG = roundTo((energy / 1000) * 14, 1);

  return {
    energyKcal: energy,
    proteinG,
    carbsG,
    fatG,
    fiberG,
    estimatedTdeeKcal: Math.round(tdee),
    bmrKcal: Math.round(bmr.kcal),
    bmrMethod: bmr.method,
    weeklyRatePct: rate,
    notes,
    rationale,
    basis: "estimated",
  };
}

export function ageFromBirthDate(birthDate: string, on: Date = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = on.getUTCFullYear() - y;
  const beforeBirthday = on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
