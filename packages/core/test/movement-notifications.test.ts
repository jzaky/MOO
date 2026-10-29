import { describe, expect, it } from "vitest";
import { analyzeMovement, inQuietHours, jointAngle, LM, localTimeToUtc, planNotifications, type Frame, type Point } from "../src";

/** Build a pose whose knee angle (both legs) equals `deg`, optional right-leg offset. */
function squatPose(deg: number, rightOffset = 0, vis = 0.95): Point[] {
  const pts: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: vis }));
  const leg = (d: number, xBase: number) => {
    const r = (d * Math.PI) / 180;
    const knee = { x: xBase, y: 0.6, visibility: vis };
    const ankle = { x: xBase, y: 0.8, visibility: vis };
    const hip = { x: xBase + 0.2 * Math.sin(r), y: 0.6 + 0.2 * Math.cos(r), visibility: vis };
    return { hip, knee, ankle };
  };
  const L = leg(deg, 0.4), R = leg(deg + rightOffset, 0.6);
  pts[LM.leftHip] = L.hip; pts[LM.leftKnee] = L.knee; pts[LM.leftAnkle] = L.ankle;
  pts[LM.rightHip] = R.hip; pts[LM.rightKnee] = R.knee; pts[LM.rightAnkle] = R.ankle;
  return pts;
}

function squatSet(depths: number[], repMs: number[] | number = 2000, fps = 30, opts: { rightOffset?: number; vis?: number } = {}): Frame[] {
  const frames: Frame[] = [];
  let t = 0;
  for (let i = 0; i < 15; i++, t += 1000 / fps) frames.push({ tMs: t, landmarks: squatPose(172, opts.rightOffset, opts.vis) });
  depths.forEach((bottom, k) => {
    const dur = Array.isArray(repMs) ? repMs[k]! : repMs;
    const n = Math.round((dur / 1000) * fps);
    for (let i = 0; i <= n; i++, t += 1000 / fps) {
      const phase = Math.sin((Math.PI * i) / n); // 0 → 1 → 0
      frames.push({ tMs: t, landmarks: squatPose(172 - (172 - bottom) * phase, opts.rightOffset, opts.vis) });
    }
    for (let i = 0; i < 10; i++, t += 1000 / fps) frames.push({ tMs: t, landmarks: squatPose(172, opts.rightOffset, opts.vis) });
  });
  return frames;
}

describe("movement analysis", () => {
  it("computes joint angles", () => {
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
  });

  it("counts squat reps and reports consistent depth", () => {
    const a = analyzeMovement("squat", squatSet([95, 92, 96, 94, 93]));
    expect(a.repCount).toBe(5);
    expect(a.depthVariationDeg!).toBeLessThan(12);
    expect(a.observations.join(" ")).toMatch(/consistent/);
    expect(a.limitations.join(" ")).toMatch(/does not assess injury/);
  });

  it("flags varying depth, speeding up and asymmetry without judging safety", () => {
    const a = analyzeMovement("squat", squatSet([90, 108, 92, 110], [2400, 2400, 1400, 1400], 30, { rightOffset: -18 }));
    expect(a.repCount).toBe(4);
    expect(a.observations.join(" ")).toMatch(/varied by about/);
    expect(a.tempoTrend).toBe("faster");
    expect(a.asymmetryDeg!).toBeGreaterThan(15);
  });

  it("ignores partial movements that never reach the bottom threshold", () => {
    expect(analyzeMovement("squat", squatSet([130, 125])).repCount).toBe(0);
  });

  it("warns when tracking confidence is low", () => {
    const a = analyzeMovement("squat", squatSet([95, 95, 95], 2000, 30, { vis: 0.6 }));
    expect(a.limitations[0]).toMatch(/Tracking confidence was low/);
  });
});

describe("notification planner", () => {
  const prefs = { workoutReminders: true, mealReminders: true, hydrationReminders: false, weeklySummary: true, checkIns: false, quietStart: "22:00", quietEnd: "07:00" };

  it("handles quiet hours across midnight", () => {
    expect(inQuietHours("23:30", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("06:59", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("07:00", "22:00", "07:00")).toBe(false);
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
  });

  it("plans workout and meal reminders, skipping completed or logged items", () => {
    const plan = planNotifications(prefs, { timeZone: "Asia/Dubai", plannedWorkouts: [{ weekday: 1, name: "Upper A" }, { weekday: 3, name: "Lower A" }], mealTimes: [{ meal: "breakfast", time: "06:30" }], completedWorkoutDays: ["2026-10-28"], loggedMeals: ["2026-10-26:breakfast"] }, "2026-10-26", 3);
    expect(plan.filter((p) => p.kind === "workout").map((p) => p.localDay)).toEqual(["2026-10-26"]);
    const meals = plan.filter((p) => p.kind === "meal");
    expect(meals.map((m) => m.localDay)).toEqual(["2026-10-27", "2026-10-28"]);
    expect(meals[0]!.localTime).toBe("07:00"); // moved out of quiet hours
    expect(plan.find((p) => p.kind === "weekly_summary")!.localDay).toBe("2026-10-26");
    expect(plan.every((p) => !/missed|failed|lazy|should have/i.test(p.title + p.body))).toBe(true);
  });

  it("converts local times to UTC across DST", () => {
    expect(localTimeToUtc("2026-10-28", "17:00", "Asia/Dubai").toISOString()).toBe("2026-10-28T13:00:00.000Z");
    expect(localTimeToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(localTimeToUtc("2026-12-01", "09:00", "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});
