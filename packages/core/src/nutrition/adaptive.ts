import { mean } from "../analytics/stats";
import { estimateRate, type WeighIn } from "../body/trend";
import { addDays, type DayKey } from "../time";
import { CALORIE_FLOOR, KCAL_PER_KG_BODY_MASS, MAX_DEFICIT_FRACTION, type Sex } from "./targets";

/**
 * Adaptive energy-target engine.
 *
 * Estimates the user's effective maintenance intake from LOGGED intake and the
 * body-weight TREND (energy balance: intake − stored energy change), then
 * proposes a conservative target change. Key properties:
 *
 *  - Uses logged intake as-is. Under-logging biases the estimate low, but the
 *    proposed target is expressed in the same "logged calories" currency, so it
 *    stays self-consistent as long as logging habits are stable.
 *  - Ignores wearable calorie burn entirely.
 *  - Requires ≥ 14 adequately-logged days and a usable weight trend.
 *  - Blends with the prior estimate (more data → more weight on observation).
 *  - Caps each adjustment (default ±150 kcal) and enforces safety floors.
 *  - Only ever PROPOSES; applying requires explicit user approval.
 */

export interface IntakeDay {
  day: DayKey;
  /** Logged kcal for the day; null if nothing logged. */
  kcal: number | null;
  /** True when the user marked the day complete, or logging met the completeness rule. */
  complete: boolean;
}

export interface AdaptiveInputs {
  asOf: DayKey;
  intake: readonly IntakeDay[];
  weighIns: readonly WeighIn[];
  currentTargetKcal: number;
  /** Previous maintenance estimate (initially the formula TDEE). */
  priorTdeeKcal: number;
  /** Goal rate as fraction of body weight per week (e.g. -0.005). */
  goalWeeklyRatePct: number;
  sex: Sex;
  windowDays?: number;
  maxStepKcal?: number;
}

export type AdaptiveStatus = "insufficient_data" | "adherence_gap" | "on_track" | "adjust";

export interface AdaptiveResult {
  status: AdaptiveStatus;
  observedTdeeKcal: number | null;
  blendedTdeeKcal: number;
  proposedTargetKcal: number;
  changeKcal: number;
  confidence: "low" | "medium" | "high";
  completeDays: number;
  observedKgPerWeek: number | null;
  goalKgPerWeek: number | null;
  reasons: string[];
}

export const MIN_COMPLETE_DAYS = 14;
/** If average logged intake differs from the target by more than this, the target itself is not what is being tested. */
export const ADHERENCE_TOLERANCE = 0.1;
const NO_CHANGE_THRESHOLD_KCAL = 50;

export function runAdaptiveCheck(input: AdaptiveInputs): AdaptiveResult {
  const windowDays = input.windowDays ?? 28;
  const maxStep = input.maxStepKcal ?? 150;
  const start = addDays(input.asOf, -(windowDays - 1));
  const reasons: string[] = [];

  const days = input.intake.filter((d) => d.day >= start && d.day <= input.asOf);
  const complete = days.filter((d) => d.complete && d.kcal !== null && d.kcal > 0);
  const avgIntake = mean(complete.map((d) => d.kcal as number));
  const rate = estimateRate(input.weighIns, input.asOf, windowDays);

  const base: AdaptiveResult = {
    status: "insufficient_data",
    observedTdeeKcal: null,
    blendedTdeeKcal: input.priorTdeeKcal,
    proposedTargetKcal: input.currentTargetKcal,
    changeKcal: 0,
    confidence: "low",
    completeDays: complete.length,
    observedKgPerWeek: rate.kgPerWeek,
    goalKgPerWeek: rate.latestTrendKg ? input.goalWeeklyRatePct * rate.latestTrendKg : null,
    reasons,
  };

  if (complete.length < MIN_COMPLETE_DAYS) {
    reasons.push(`Needs at least ${MIN_COMPLETE_DAYS} fully logged days in the last ${windowDays}; found ${complete.length}.`);
  }
  if (rate.sufficiency === "insufficient" || rate.kgPerWeek === null || rate.latestTrendKg === null) {
    reasons.push("Not enough weigh-ins to estimate a reliable weight trend.");
  }
  if (reasons.length || avgIntake === null || rate.kgPerWeek === null || rate.latestTrendKg === null) return base;

  const storedKcalPerDay = (rate.kgPerWeek / 7) * KCAL_PER_KG_BODY_MASS;
  const intakeGap = (avgIntake - input.currentTargetKcal) / input.currentTargetKcal;
  const observed = avgIntake - storedKcalPerDay;

  const coverage = Math.min(1, complete.length / windowDays);
  const trendWeight = rate.sufficiency === "good" ? 1 : 0.6;
  const w = 0.6 * coverage * trendWeight;
  const blended = input.priorTdeeKcal + w * (observed - input.priorTdeeKcal);

  const goalKgPerWeek = input.goalWeeklyRatePct * rate.latestTrendKg;
  const goalDeltaPerDay = (goalKgPerWeek / 7) * KCAL_PER_KG_BODY_MASS;
  let ideal = blended + goalDeltaPerDay;

  const floor = CALORIE_FLOOR[input.sex];
  if (ideal < blended * (1 - MAX_DEFICIT_FRACTION)) {
    ideal = blended * (1 - MAX_DEFICIT_FRACTION);
    reasons.push("Deficit limited to 25% of estimated maintenance.");
  }
  if (ideal < floor) {
    ideal = floor;
    reasons.push(`Target held at the ${floor} kcal safety floor.`);
  }

  let change = ideal - input.currentTargetKcal;
  if (Math.abs(change) > maxStep) {
    change = Math.sign(change) * maxStep;
    reasons.push(`Change limited to ${maxStep} kcal per check-in to avoid over-reacting.`);
  }
  change = Math.round(change / 10) * 10;

  const confidence: AdaptiveResult["confidence"] =
    rate.sufficiency === "good" && complete.length >= 21 ? "high" : rate.sufficiency === "good" || complete.length >= 21 ? "medium" : "low";

  reasons.unshift(
    `Average logged intake ${Math.round(avgIntake)} kcal over ${complete.length} complete days; trend weight changed ${rate.kgPerWeek >= 0 ? "+" : ""}${rate.kgPerWeek.toFixed(2)} kg/week.`,
    `Estimated maintenance from this data ≈ ${Math.round(observed)} kcal (blended estimate ${Math.round(blended)} kcal).`,
  );

  if (Math.abs(intakeGap) > ADHERENCE_TOLERANCE) {
    return {
      ...base,
      status: "adherence_gap",
      observedTdeeKcal: Math.round(observed),
      blendedTdeeKcal: Math.round(blended),
      confidence,
      goalKgPerWeek,
      reasons: [
        ...reasons,
        `Logged intake averaged ${Math.abs(Math.round(intakeGap * 100))}% ${intakeGap < 0 ? "below" : "above"} the ${input.currentTargetKcal} kcal target, so the observed weight change reflects actual intake rather than the target. No target change is suggested; the maintenance estimate has still been updated.`,
      ],
    };
  }

  const rateGap = Math.abs(rate.kgPerWeek - goalKgPerWeek);
  const onTrackTolerance = Math.max(0.1, 0.0015 * rate.latestTrendKg);
  if (Math.abs(change) < NO_CHANGE_THRESHOLD_KCAL || rateGap <= onTrackTolerance) {
    return {
      ...base,
      status: "on_track",
      observedTdeeKcal: Math.round(observed),
      blendedTdeeKcal: Math.round(blended),
      confidence,
      goalKgPerWeek,
      reasons: [...reasons, "Current target is producing roughly the intended rate; no change suggested."],
    };
  }

  return {
    ...base,
    status: "adjust",
    observedTdeeKcal: Math.round(observed),
    blendedTdeeKcal: Math.round(blended),
    proposedTargetKcal: input.currentTargetKcal + change,
    changeKcal: change,
    confidence,
    goalKgPerWeek,
    reasons,
  };
}
