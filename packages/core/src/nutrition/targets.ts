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
  /** Fraction of calories from fat (default 0.28). */
  fatShare?: number;
}

/** Bounds on weekly body-weight change (fraction of body weight). */
export const RATE_LIMITS = { minLoss: -0.01, maxGain: 0.005 } as const;
/** Absolute calorie floors below which we refuse to set a target without clinical supervision. */
export const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };
/** Never prescribe a deficit larger than this fraction of estimated TDEE. */
export const MAX_DEFICIT_FRACTION = 0.25;
/** Energy density of body-mass change used for planning (kcal per kg). Approximate. */
export const KCAL_PER_KG_BODY_MASS = 7700;

const DEFAULT_RATE: Record<PrimaryGoal, number> = {
  lose_fat: -0.005,
  build_muscle: 0.0025,
  maintain: 0,
  recomposition: 0,
  strength: 0.001,
  general_fitness: 0,
  endurance: 0,
};

const PROTEIN_G_PER_KG: Record<PrimaryGoal, number> = {
  lose_fat: 2.0,
  build_muscle: 1.8,
  maintain: 1.6,
  recomposition: 2.0,
  strength: 1.8,
  general_fitness: 1.6,
  endurance: 1.6,
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

  let rate = opts.weeklyRatePct ?? DEFAULT_RATE[opts.goal];
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
  let proteinG = roundTo(proteinBasisKg * PROTEIN_G_PER_KG[opts.goal], 5);

  const fatShare = Math.min(Math.max(opts.fatShare ?? 0.28, 0.2), 0.4);
  let fatG = Math.max((energy * fatShare) / 9, 0.6 * body.weightKg);
  fatG = roundTo(fatG, 5);

  let carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
  if (carbsG < 50) {
    // Low-energy targets: keep a minimum carbohydrate allowance by trimming fat to its floor first.
    const fatFloor = roundTo(0.6 * body.weightKg, 5);
    fatG = Math.max(fatFloor, fatG - ((50 - carbsG) * 4) / 9);
    fatG = roundTo(fatG, 5);
    carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
    if (carbsG < 50) {
      proteinG = roundTo(Math.max(1.4 * proteinBasisKg, (energy - fatG * 9 - 50 * 4) / 4), 5);
      carbsG = (energy - proteinG * 4 - fatG * 9) / 4;
      notes.push("Protein reduced to keep a minimum carbohydrate allowance at this energy level.");
    }
  }
  carbsG = Math.max(0, roundTo(carbsG, 5));

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
