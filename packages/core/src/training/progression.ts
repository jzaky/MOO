import { daysBetween, type DayKey } from "../time";
import { nextLoadDown, nextLoadUp, roundToAchievable, type LoadProfile } from "./equipment";
import { bestE1rm, effectiveRir, isWorkSet, type LoggedSet } from "./sets";

/**
 * Deterministic progressive-overload engine.
 *
 * The LLM may *explain* a recommendation; it never computes one. Every output
 * is a proposal (`requiresConfirmation: true`) and carries human-readable
 * reasons derived from the same rules tested in progression.test.ts.
 */

export type ProgressionScheme = "double_progression" | "linear" | "rpe_target";

export interface Prescription {
  scheme: ProgressionScheme;
  sets: number;
  repRange: { min: number; max: number };
  /** Target reps in reserve for working sets (used by rpe_target and effort checks). */
  targetRir?: number | null;
  loadProfile: LoadProfile;
  /**
   * Double progression: total reps below the top of the range still allowed
   * when deciding to add load (0 = every set must hit the top).
   */
  allowShortfall?: number;
  /** Linear scheme: increment to attempt per successful session. */
  linearIncrementKg?: number;
  /** Sessions without e1RM improvement before suggesting a deload. */
  stallSessions?: number;
  /** Consecutive sessions below the rep floor before reducing load. */
  failuresBeforeReduction?: number;
}

export interface SessionPerformance {
  day: DayKey;
  sets: readonly LoggedSet[];
}

export type ReadinessSignal = "good" | "normal" | "poor";

export type ProgressionAction = "establish_baseline" | "increase_load" | "increase_reps" | "maintain" | "reduce_load" | "deload";

export interface ProgressionRecommendation {
  action: ProgressionAction;
  targetLoadKg: number | null;
  targetReps: number[];
  targetSets: number;
  reasons: string[];
  confidence: "low" | "medium" | "high";
  requiresConfirmation: true;
}

export interface ProgressionContext {
  today: DayKey;
  readiness?: ReadinessSignal;
}

function workSets(s: SessionPerformance): LoggedSet[] {
  return s.sets.filter(isWorkSet);
}

/** Load used for the majority of working sets (ties → heavier). */
export function workingLoad(sets: readonly LoggedSet[]): number | null {
  const counts = new Map<number, number>();
  for (const s of sets) counts.set(s.weightKg, (counts.get(s.weightKg) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [load, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== null && load > best)) {
      best = load;
      bestCount = c;
    }
  }
  return best;
}

function fmtKg(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0$/, "")} kg`;
}

function fmtSets(sets: readonly LoggedSet[]): string {
  return sets.map((s) => `${fmtKg(s.weightKg)}×${s.reps}`).join(", ");
}

function repeatTargets(n: number, reps: number): number[] {
  return Array.from({ length: n }, () => reps);
}

export function recommendProgression(
  prescription: Prescription,
  history: readonly SessionPerformance[],
  ctx: ProgressionContext,
): ProgressionRecommendation {
  const p = prescription;
  if (p.repRange.min < 1 || p.repRange.max < p.repRange.min) throw new RangeError("Invalid rep range");
  if (p.sets < 1) throw new RangeError("Sets must be ≥ 1");

  const sessions = [...history].filter((s) => workSets(s).length > 0).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const base = { targetSets: p.sets, requiresConfirmation: true as const };

  if (sessions.length === 0) {
    return {
      ...base,
      action: "establish_baseline",
      targetLoadKg: null,
      targetReps: repeatTargets(p.sets, p.repRange.min),
      reasons: ["No previous working sets recorded. Choose a load you can lift for the bottom of the rep range with a few reps to spare."],
      confidence: "low",
    };
  }

  const last = sessions[sessions.length - 1]!;
  const lastSets = workSets(last);
  const load = workingLoad(lastSets)!;
  const atLoad = lastSets.filter((s) => s.weightKg === load);
  const reasons: string[] = [`Last session (${last.day}): ${fmtSets(lastSets)}.`];

  // Long layoff: re-acclimate before progressing.
  const gap = daysBetween(last.day, ctx.today);
  if (gap > 21) {
    const reduced = p.loadProfile.kind === "bodyweight" ? 0 : roundToAchievable(p.loadProfile, load * 0.9);
    return {
      ...base,
      action: "reduce_load",
      targetLoadKg: reduced,
      targetReps: repeatTargets(p.sets, p.repRange.min),
      reasons: [...reasons, `It has been ${gap} days since this exercise was trained; starting about 10% lighter is a common way to re-acclimate.`],
      confidence: "medium",
    };
  }

  // Stall → deload.
  const stallN = p.stallSessions ?? 3;
  if (sessions.length > stallN) {
    const before = bestE1rm(workSets(sessions[sessions.length - stallN - 1]!));
    const recent = sessions.slice(-stallN).map((s) => bestE1rm(workSets(s)) ?? 0);
    if (before !== null && Math.max(...recent) <= before * 1.005) {
      const deloadLoad = p.loadProfile.kind === "bodyweight" ? 0 : roundToAchievable(p.loadProfile, load * 0.9);
      return {
        ...base,
        action: "deload",
        targetLoadKg: deloadLoad,
        targetSets: Math.max(1, Math.ceil(p.sets * 0.6)),
        targetReps: repeatTargets(Math.max(1, Math.ceil(p.sets * 0.6)), p.repRange.min),
        reasons: [
          ...reasons,
          `Estimated strength has not improved over the last ${stallN} sessions.`,
          "A lighter session (≈10% less load, fewer sets) before resuming progression is suggested. Consider sleep, nutrition and recent training load too.",
        ],
        confidence: "medium",
      };
    }
  }

  // Consecutive sessions below the rep floor at the current or heavier load.
  const failThreshold = p.failuresBeforeReduction ?? 2;
  let consecutiveFails = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const ws = workSets(sessions[i]!);
    const l = workingLoad(ws)!;
    if (l < load) break;
    if (ws.filter((s) => s.weightKg === l).some((s) => s.reps < p.repRange.min)) consecutiveFails += 1;
    else break;
  }

  const poorReadiness = ctx.readiness === "poor";

  if (consecutiveFails >= failThreshold) {
    const down = p.loadProfile.kind === "bodyweight" ? 0 : nextLoadDown(p.loadProfile, load) ?? load;
    return {
      ...base,
      action: "reduce_load",
      targetLoadKg: down,
      targetReps: repeatTargets(p.sets, p.repRange.min),
      reasons: [...reasons, `Reps fell below ${p.repRange.min} in ${consecutiveFails} consecutive sessions at this load.`],
      confidence: "high",
    };
  }
  if (consecutiveFails > 0) {
    return {
      ...base,
      action: "maintain",
      targetLoadKg: load,
      targetReps: repeatTargets(p.sets, p.repRange.min),
      reasons: [...reasons, `Some sets were below ${p.repRange.min} reps; repeat this load and aim for the bottom of the range on every set.`],
      confidence: "medium",
    };
  }

  if (p.scheme === "linear") {
    const target = p.repRange.min;
    const success = atLoad.length >= p.sets && atLoad.every((s) => s.reps >= target);
    if (!success) {
      return { ...base, action: "maintain", targetLoadKg: load, targetReps: repeatTargets(p.sets, target), reasons: [...reasons, "Not all prescribed sets were completed; repeat this load."], confidence: "medium" };
    }
    if (poorReadiness) {
      return { ...base, action: "maintain", targetLoadKg: load, targetReps: repeatTargets(p.sets, target), reasons: [...reasons, "All sets completed, but recovery looks poor today; holding the load is reasonable."], confidence: "medium" };
    }
    const inc = p.linearIncrementKg ?? 2.5;
    const next = p.loadProfile.kind === "bodyweight" ? 0 : Math.max(roundToAchievable(p.loadProfile, load + inc), nextLoadUp(p.loadProfile, load) ?? load);
    return { ...base, action: "increase_load", targetLoadKg: next, targetReps: repeatTargets(p.sets, target), reasons: [...reasons, `All sets completed; next achievable load is ${fmtKg(next)}.`], confidence: "high" };
  }

  if (p.scheme === "rpe_target") {
    const targetRir = p.targetRir ?? 2;
    const e1rm = bestE1rm(lastSets);
    if (e1rm === null || p.loadProfile.kind === "bodyweight") {
      return { ...base, action: "maintain", targetLoadKg: load, targetReps: repeatTargets(p.sets, p.repRange.max), reasons: [...reasons, "Cannot estimate a load from the last session; repeat it."], confidence: "low" };
    }
    const reps = p.repRange.max;
    const raw = e1rm / (1 + (reps + targetRir) / 30);
    let target = roundToAchievable(p.loadProfile, Math.min(raw, load * 1.05));
    if (poorReadiness) target = Math.min(target, load);
    const action: ProgressionAction = target > load ? "increase_load" : target < load ? "reduce_load" : "maintain";
    return {
      ...base,
      action,
      targetLoadKg: target,
      targetReps: repeatTargets(p.sets, reps),
      reasons: [...reasons, `Estimated 1RM ≈ ${fmtKg(Math.round(e1rm * 10) / 10)}; ${reps} reps at ${targetRir} RIR suggests ≈ ${fmtKg(Math.round(raw * 10) / 10)} (changes capped at +5%).`],
      confidence: "medium",
    };
  }

  // Double progression.
  const top = p.repRange.max;
  const shortfall = atLoad.reduce((acc, s) => acc + Math.max(0, top - s.reps), 0) + Math.max(0, p.sets - atLoad.length) * top;
  const allowed = p.allowShortfall ?? 0;
  const lastRir = atLoad.map(effectiveRir).filter((x): x is number => x !== null);
  const hitTop = shortfall <= allowed && atLoad.length >= p.sets;

  if (hitTop) {
    if (poorReadiness) {
      return { ...base, action: "maintain", targetLoadKg: load, targetReps: repeatTargets(p.sets, top), reasons: [...reasons, "You reached the top of the rep range, but recovery looks poor; consider repeating before adding load."], confidence: "medium" };
    }
    const up = p.loadProfile.kind === "bodyweight" ? null : nextLoadUp(p.loadProfile, load);
    if (up === null) {
      return {
        ...base,
        action: "increase_reps",
        targetLoadKg: load,
        targetReps: repeatTargets(p.sets, top + 1),
        reasons: [...reasons, "Top of the rep range reached and no heavier load is available; extend reps or choose a harder variation."],
        confidence: "medium",
      };
    }
    const jumpPct = ((up - load) / Math.max(load, 1)) * 100;
    const r = [...reasons, `All working sets reached ${top} reps${allowed ? ` (within ${allowed} rep${allowed > 1 ? "s" : ""})` : ""}; progress to ${fmtKg(up)} and restart at ${p.repRange.min} reps.`];
    if (jumpPct > 10) r.push(`That is a ${Math.round(jumpPct)}% jump because of equipment increments; expect fewer reps at first.`);
    if (lastRir.length && p.targetRir != null && Math.min(...lastRir) < p.targetRir - 1) r.push("Sets were closer to failure than targeted; leave a little more in reserve next time.");
    return { ...base, action: "increase_load", targetLoadKg: up, targetReps: repeatTargets(p.sets, p.repRange.min), reasons: r, confidence: "high" };
  }

  const targetReps = Array.from({ length: p.sets }, (_, i) => {
    const prev = atLoad[i]?.reps ?? p.repRange.min;
    return Math.min(top, poorReadiness ? prev : prev + 1);
  });
  return {
    ...base,
    action: poorReadiness ? "maintain" : "increase_reps",
    targetLoadKg: load,
    targetReps,
    reasons: [
      ...reasons,
      poorReadiness
        ? "Recovery looks poor; matching last session's reps is a reasonable target."
        : `Within the ${p.repRange.min}–${top} range; add a rep where possible before increasing load.`,
    ],
    confidence: "high",
  };
}
