import { linearRegression, mean } from "../analytics/stats";
import { addDays, daysBetween, type DayKey } from "../time";

/**
 * Body-weight trend.
 *
 * Daily scale weight swings 1–2 kg with water, glycogen and gut content, so we
 * never interpret a single reading. We use an exponentially weighted moving
 * average (EWMA, α = 0.1/day, à la "The Hacker's Diet"), which handles missing
 * days by decaying over the gap, and estimate the rate of change from a
 * regression over the trend line.
 */

export interface WeighIn {
  day: DayKey;
  kg: number;
}

export interface TrendPoint {
  day: DayKey;
  /** Mean of the readings that day. */
  scaleKg: number;
  trendKg: number;
}

export const DEFAULT_ALPHA = 0.1;

/** Collapse multiple readings per day to their mean, sorted ascending. */
export function dailyWeights(weighIns: readonly WeighIn[]): WeighIn[] {
  const byDay = new Map<DayKey, number[]>();
  for (const w of weighIns) {
    if (!(w.kg > 0)) continue;
    const arr = byDay.get(w.day) ?? [];
    arr.push(w.kg);
    byDay.set(w.day, arr);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, kgs]) => ({ day, kg: mean(kgs)! }));
}

export function ewmaTrend(weighIns: readonly WeighIn[], alpha = DEFAULT_ALPHA): TrendPoint[] {
  const days = dailyWeights(weighIns);
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDay: DayKey | null = null;
  for (const { day, kg } of days) {
    if (trend === null || prevDay === null) {
      trend = kg;
    } else {
      const gap = Math.max(1, daysBetween(prevDay, day));
      const effAlpha = 1 - (1 - alpha) ** gap;
      trend = trend + effAlpha * (kg - trend);
    }
    out.push({ day, scaleKg: kg, trendKg: trend });
    prevDay = day;
  }
  return out;
}

/** Simple trailing average of readings in the 7 calendar days ending at `day`. */
export function sevenDayAverage(weighIns: readonly WeighIn[], day: DayKey): number | null {
  const start = addDays(day, -6);
  const vals = dailyWeights(weighIns).filter((w) => w.day >= start && w.day <= day).map((w) => w.kg);
  return mean(vals);
}

export type Sufficiency = "insufficient" | "limited" | "good";

export interface RateEstimate {
  /** kg per week; negative = losing. */
  kgPerWeek: number | null;
  /** Percentage of current trend weight per week. */
  pctPerWeek: number | null;
  windowDays: number;
  readings: number;
  sufficiency: Sufficiency;
  latestTrendKg: number | null;
}

/**
 * Rate of change over the trailing window, from a least-squares fit to the
 * trend values. Sufficiency gates how strongly the UI/coach may speak:
 *   insufficient: < 7 readings or < 10 days spanned → show no rate.
 *   limited:      < 14 readings or < 21 days → show with caution.
 */
export function estimateRate(weighIns: readonly WeighIn[], asOf: DayKey, windowDays = 28, alpha = DEFAULT_ALPHA): RateEstimate {
  const trend = ewmaTrend(weighIns, alpha).filter((p) => p.day <= asOf);
  const start = addDays(asOf, -(windowDays - 1));
  const win = trend.filter((p) => p.day >= start);
  const latest = trend.length ? trend[trend.length - 1]!.trendKg : null;
  const base: RateEstimate = { kgPerWeek: null, pctPerWeek: null, windowDays, readings: win.length, sufficiency: "insufficient", latestTrendKg: latest };
  if (win.length < 2) return base;
  const span = daysBetween(win[0]!.day, win[win.length - 1]!.day);
  if (win.length < 7 || span < 10) return base;
  const fit = linearRegression(win.map((p) => ({ x: daysBetween(start, p.day), y: p.trendKg })));
  if (!fit) return base;
  const kgPerWeek = fit.slope * 7;
  const sufficiency: Sufficiency = win.length >= 14 && span >= 21 ? "good" : "limited";
  return {
    ...base,
    kgPerWeek,
    pctPerWeek: latest ? (kgPerWeek / latest) * 100 : null,
    sufficiency,
  };
}

export interface GoalProgress {
  startKg: number;
  currentTrendKg: number;
  goalKg: number;
  /** 0..1 progress from start toward goal (clamped). */
  fraction: number;
  /** Estimated weeks remaining at the current rate, if moving toward the goal. */
  weeksRemaining: number | null;
}

export function goalProgress(startKg: number, currentTrendKg: number, goalKg: number, kgPerWeek: number | null): GoalProgress {
  const total = goalKg - startKg;
  const done = currentTrendKg - startKg;
  const fraction = total === 0 ? 1 : Math.min(1, Math.max(0, done / total));
  let weeksRemaining: number | null = null;
  const remaining = goalKg - currentTrendKg;
  if (kgPerWeek && Math.sign(kgPerWeek) === Math.sign(remaining) && Math.abs(kgPerWeek) > 0.02) {
    weeksRemaining = remaining / kgPerWeek;
  }
  return { startKg, currentTrendKg, goalKg, fraction, weeksRemaining };
}
