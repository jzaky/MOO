import { mean } from "../analytics/stats";
import { addDays, type DayKey } from "../time";

/**
 * Recovery insights. Deliberately NOT a composite "recovery score": each
 * insight is a plain comparison of one signal against the user's own recent
 * baseline, with the numbers shown. Thresholds are conservative heuristics.
 */

export interface DailySignals {
  day: DayKey;
  sleepMinutes?: number | null;
  restingHr?: number | null;
  /** Σ (sets × RPE-or-7) or session-RPE × minutes; any consistent load unit. */
  trainingLoad?: number | null;
  /** 1 (very fresh) … 5 (very fatigued). */
  fatigue?: number | null;
  /** 1 (none) … 5 (severe). */
  soreness?: number | null;
}

export interface RecoveryInsight {
  id: "sleep_below_baseline" | "rhr_above_baseline" | "load_spike" | "high_subjective_fatigue";
  severity: "info" | "caution";
  message: string;
  evidence: Record<string, number>;
}

function window<T extends DailySignals>(signals: readonly T[], end: DayKey, days: number): T[] {
  const start = addDays(end, -(days - 1));
  return signals.filter((s) => s.day >= start && s.day <= end);
}

function values(xs: readonly DailySignals[], k: keyof DailySignals): number[] {
  return xs.map((x) => x[k]).filter((v): v is number => typeof v === "number");
}

export function recoveryInsights(signals: readonly DailySignals[], asOf: DayKey): RecoveryInsight[] {
  const out: RecoveryInsight[] = [];
  const recent = window(signals, asOf, 3);
  const baseline = window(signals, addDays(asOf, -3), 28);

  const rSleep = mean(values(recent, "sleepMinutes"));
  const bSleepVals = values(baseline, "sleepMinutes");
  const bSleep = mean(bSleepVals);
  if (rSleep !== null && bSleep !== null && bSleepVals.length >= 7 && rSleep < bSleep - 45) {
    out.push({
      id: "sleep_below_baseline",
      severity: rSleep < bSleep - 90 ? "caution" : "info",
      message: `Sleep over the last 3 nights averaged ${Math.round(rSleep / 6) / 10} h, below your recent average of ${Math.round(bSleep / 6) / 10} h.`,
      evidence: { recentAvgMin: Math.round(rSleep), baselineAvgMin: Math.round(bSleep) },
    });
  }

  const rHr = mean(values(recent, "restingHr"));
  const bHrVals = values(baseline, "restingHr");
  const bHr = mean(bHrVals);
  if (rHr !== null && bHr !== null && bHrVals.length >= 7 && rHr > bHr + 5) {
    out.push({
      id: "rhr_above_baseline",
      severity: "info",
      message: `Resting heart rate is about ${Math.round(rHr - bHr)} bpm above your recent average. This can reflect fatigue, illness, heat, alcohol or stress.`,
      evidence: { recentAvg: Math.round(rHr), baselineAvg: Math.round(bHr) },
    });
  }

  // Acute (7 d) vs chronic (28 d weekly average) training load.
  const acute = values(window(signals, asOf, 7), "trainingLoad").reduce((a, b) => a + b, 0);
  const chronicVals = values(window(signals, asOf, 28), "trainingLoad");
  const chronicWeekly = chronicVals.reduce((a, b) => a + b, 0) / 4;
  if (chronicVals.length >= 8 && chronicWeekly > 0 && acute / chronicWeekly > 1.5) {
    out.push({
      id: "load_spike",
      severity: "caution",
      message: `Training load this week is about ${Math.round((acute / chronicWeekly - 1) * 100)}% higher than your 4-week average.`,
      evidence: { acute: Math.round(acute), chronicWeekly: Math.round(chronicWeekly) },
    });
  }

  const fatigue = mean(values(recent, "fatigue"));
  if (fatigue !== null && fatigue >= 4) {
    out.push({
      id: "high_subjective_fatigue",
      severity: "caution",
      message: "You have reported high fatigue recently. An easier session or extra rest may help; adjusting rather than skipping is usually an option.",
      evidence: { recentAvgFatigue: Math.round(fatigue * 10) / 10 },
    });
  }
  return out;
}

/** Maps insights to a progression readiness signal (used by the progression engine). */
export function readinessFromInsights(insights: readonly RecoveryInsight[]): "good" | "normal" | "poor" {
  const cautions = insights.filter((i) => i.severity === "caution").length;
  if (cautions >= 2) return "poor";
  if (insights.some((i) => i.id === "high_subjective_fatigue")) return "poor";
  return insights.length ? "normal" : "good";
}
