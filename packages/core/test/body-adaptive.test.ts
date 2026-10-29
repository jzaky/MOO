import { describe, expect, it } from "vitest";
import { addDays, estimateRate, ewmaTrend, goalProgress, runAdaptiveCheck, sevenDayAverage, type IntakeDay, type WeighIn } from "../src";

/** Synthetic weigh-ins: linear trend plus deterministic ±0.6 kg "water noise". */
function series(start: string, days: number, startKg: number, kgPerWeek: number, skipEvery = 0): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = 0; i < days; i++) {
    if (skipEvery && i % skipEvery === 0 && i !== 0) continue;
    const noise = Math.sin(i * 1.7) * 0.6;
    out.push({ day: addDays(start, i), kg: startKg + (kgPerWeek / 7) * i + noise });
  }
  return out;
}

describe("weight trend", () => {
  it("smooths noise and handles multiple readings per day", () => {
    const t = ewmaTrend([
      { day: "2026-10-01", kg: 80 },
      { day: "2026-10-01", kg: 81 },
      { day: "2026-10-02", kg: 82 },
    ]);
    expect(t[0]!.scaleKg).toBe(80.5);
    expect(t[1]!.trendKg).toBeCloseTo(80.5 + 0.1 * 1.5);
  });

  it("decays over gaps rather than treating them as one day", () => {
    const t = ewmaTrend([
      { day: "2026-10-01", kg: 80 },
      { day: "2026-10-11", kg: 78 },
    ]);
    expect(t[1]!.trendKg).toBeCloseTo(80 - (1 - 0.9 ** 10) * 2);
  });

  it("refuses to estimate a rate from too little data", () => {
    const r = estimateRate(series("2026-10-01", 5, 80, -0.5), "2026-10-05");
    expect(r.sufficiency).toBe("insufficient");
    expect(r.kgPerWeek).toBeNull();
  });

  it("recovers the underlying rate despite noise", () => {
    const data = series("2026-08-01", 60, 85, -0.5);
    const r = estimateRate(data, addDays("2026-08-01", 59));
    expect(r.sufficiency).toBe("good");
    expect(r.kgPerWeek!).toBeGreaterThan(-0.75);
    expect(r.kgPerWeek!).toBeLessThan(-0.3);
  });

  it("computes a 7-day average and goal progress", () => {
    const data = series("2026-10-01", 14, 80, 0);
    expect(sevenDayAverage(data, "2026-10-14")).toBeCloseTo(80, 0);
    const g = goalProgress(85, 82, 79, -0.5);
    expect(g.fraction).toBeCloseTo(0.5);
    expect(g.weeksRemaining).toBeCloseTo(6);
    expect(goalProgress(85, 86, 79, 0.3).weeksRemaining).toBeNull();
  });
});

describe("adaptive nutrition engine", () => {
  const asOf = "2026-10-28";
  const start = addDays(asOf, -27);
  const intake = (kcal: number, complete = true): IntakeDay[] => Array.from({ length: 28 }, (_, i) => ({ day: addDays(start, i), kcal, complete }));

  it("does nothing without enough logged days", () => {
    const r = runAdaptiveCheck({
      asOf,
      intake: intake(2000).map((d, i) => ({ ...d, complete: i < 10 })),
      weighIns: series(start, 28, 85, -0.5),
      currentTargetKcal: 2000,
      priorTdeeKcal: 2500,
      goalWeeklyRatePct: -0.005,
      sex: "male",
    });
    expect(r.status).toBe("insufficient_data");
    expect(r.proposedTargetKcal).toBe(2000);
    expect(r.reasons[0]).toMatch(/14 fully logged days/);
  });

  it("proposes a capped increase when weight is falling much faster than intended", () => {
    // Eating 1800 and losing ~1 kg/week → maintenance ≈ 2900; goal −0.43 kg/wk.
    const r = runAdaptiveCheck({
      asOf,
      intake: intake(1800),
      weighIns: series(start, 28, 86, -1.0),
      currentTargetKcal: 1800,
      priorTdeeKcal: 2500,
      goalWeeklyRatePct: -0.005,
      sex: "male",
    });
    expect(r.status).toBe("adjust");
    expect(r.changeKcal).toBe(150);
    expect(r.proposedTargetKcal).toBe(1950);
    expect(r.observedTdeeKcal!).toBeGreaterThan(2500);
  });

  it("reports on-track when the observed rate matches the goal", () => {
    // Maintenance ≈ 2400, eating 2000 → ≈ −0.36 kg/wk; goal −0.45%/wk of 80 kg = −0.36.
    const r = runAdaptiveCheck({
      asOf,
      intake: intake(2000),
      weighIns: series(start, 28, 80, -0.36),
      currentTargetKcal: 2000,
      priorTdeeKcal: 2400,
      goalWeeklyRatePct: -0.0045,
      sex: "male",
    });
    expect(r.status).toBe("on_track");
    expect(r.changeKcal).toBe(0);
  });

  it("never proposes below the safety floor", () => {
    const r = runAdaptiveCheck({
      asOf,
      intake: intake(1300),
      weighIns: series(start, 28, 60, 0.2),
      currentTargetKcal: 1300,
      priorTdeeKcal: 1400,
      goalWeeklyRatePct: -0.01,
      sex: "female",
      maxStepKcal: 1000,
    });
    expect(r.proposedTargetKcal).toBeGreaterThanOrEqual(1200);
  });
});
