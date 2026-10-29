/**
 * Rep counting and movement-consistency metrics from pose landmarks.
 *
 * Input is a time series of 2D/3D landmarks (e.g. MediaPipe Pose Landmarker,
 * 33 points, normalized coordinates). This module is deliberately limited to
 * what can be measured: joint-angle trends, repetition count, range-of-motion
 * consistency, tempo, and left/right asymmetry in the recorded view. It does
 * NOT judge safety or diagnose anything.
 *
 * Supported (validated) movements: squat (knee angle), push-up (elbow angle).
 */

export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** MediaPipe Pose landmark indices used here. */
export const LM = { leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28 } as const;

export interface Frame {
  tMs: number;
  landmarks: readonly Point[];
}

export type MovementKind = "squat" | "push_up";

const MOVEMENTS: Record<MovementKind, { joints: [number, number, number][]; top: number; bottom: number; label: string }> = {
  // Knee angle: hip–knee–ankle. Standing ≈ 170°, parallel squat ≈ 90–100°.
  squat: { joints: [[LM.leftHip, LM.leftKnee, LM.leftAnkle], [LM.rightHip, LM.rightKnee, LM.rightAnkle]], top: 160, bottom: 110, label: "knee angle" },
  // Elbow angle: shoulder–elbow–wrist. Arms locked ≈ 170°, bottom ≈ 70–90°.
  push_up: { joints: [[LM.leftShoulder, LM.leftElbow, LM.leftWrist], [LM.rightShoulder, LM.rightElbow, LM.rightWrist]], top: 150, bottom: 100, label: "elbow angle" },
};

/** Angle at b (degrees) formed by a–b–c. */
export function jointAngle(a: Point, b: Point, c: Point): number {
  const v1 = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
  const v2 = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const dot = v1[0]! * v2[0]! + v1[1]! * v2[1]! + v1[2]! * v2[2]!;
  const n1 = Math.hypot(v1[0]!, v1[1]!, v1[2]!);
  const n2 = Math.hypot(v2[0]!, v2[1]!, v2[2]!);
  if (n1 === 0 || n2 === 0) return NaN;
  return (Math.acos(Math.min(1, Math.max(-1, dot / (n1 * n2)))) * 180) / Math.PI;
}

/** Exponential smoothing that skips NaN gaps. */
export function smooth(xs: readonly number[], alpha = 0.35): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const x of xs) {
    if (Number.isNaN(x)) {
      out.push(prev ?? NaN);
      continue;
    }
    prev = prev === null ? x : prev + alpha * (x - prev);
    out.push(prev);
  }
  return out;
}

export interface RepMetrics {
  index: number;
  startMs: number;
  bottomMs: number;
  endMs: number;
  minAngle: number;
  eccentricMs: number;
  concentricMs: number;
}

export interface MovementAnalysis {
  movement: MovementKind;
  reps: RepMetrics[];
  repCount: number;
  /** Mean visibility of the tracked joints (0–1). */
  trackingConfidence: number;
  depthVariationDeg: number | null;
  tempoTrend: "faster" | "slower" | "steady" | null;
  asymmetryDeg: number | null;
  observations: string[];
  limitations: string[];
}

/**
 * Count reps with a hysteresis state machine on the smoothed joint angle:
 * a rep is top → below `bottom` → back above `top`.
 */
export function analyzeMovement(movement: MovementKind, frames: readonly Frame[], minVisibility = 0.5): MovementAnalysis {
  const cfg = MOVEMENTS[movement];
  const sides = cfg.joints.map(([a, b, c]) =>
    frames.map((f) => {
      const pa = f.landmarks[a], pb = f.landmarks[b], pc = f.landmarks[c];
      if (!pa || !pb || !pc) return { angle: NaN, vis: 0 };
      const vis = Math.min(pa.visibility ?? 1, pb.visibility ?? 1, pc.visibility ?? 1);
      return { angle: vis >= minVisibility ? jointAngle(pa, pb, pc) : NaN, vis };
    }),
  );
  const combined = frames.map((_, i) => {
    const vals = sides.map((s) => s[i]!.angle).filter((v) => !Number.isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  });
  const visAll = sides.flat().map((s) => s.vis);
  const trackingConfidence = visAll.length ? visAll.reduce((a, b) => a + b, 0) / visAll.length : 0;
  const angle = smooth(combined);

  const reps: RepMetrics[] = [];
  let state: "top" | "down" = "top";
  let startIdx = -1, bottomIdx = -1, minAngle = Infinity;
  for (let i = 0; i < angle.length; i++) {
    const a = angle[i]!;
    if (Number.isNaN(a)) continue;
    if (state === "top") {
      if (a >= cfg.top) startIdx = i;
      if (a < cfg.bottom && startIdx >= 0) {
        state = "down";
        minAngle = a;
        bottomIdx = i;
      }
    } else {
      if (a < minAngle) {
        minAngle = a;
        bottomIdx = i;
      }
      if (a >= cfg.top) {
        reps.push({ index: reps.length + 1, startMs: frames[startIdx]!.tMs, bottomMs: frames[bottomIdx]!.tMs, endMs: frames[i]!.tMs, minAngle, eccentricMs: frames[bottomIdx]!.tMs - frames[startIdx]!.tMs, concentricMs: frames[i]!.tMs - frames[bottomIdx]!.tMs });
        state = "top";
        startIdx = i;
        minAngle = Infinity;
      }
    }
  }

  const observations: string[] = [];
  let depthVariationDeg: number | null = null;
  let tempoTrend: MovementAnalysis["tempoTrend"] = null;
  if (reps.length >= 3) {
    const mins = reps.map((r) => r.minAngle);
    depthVariationDeg = Math.max(...mins) - Math.min(...mins);
    if (depthVariationDeg > 12) observations.push(`The lowest ${cfg.label} varied by about ${Math.round(depthVariationDeg)}° between repetitions, so depth was not consistent across the set.`);
    else observations.push(`Depth was consistent: the lowest ${cfg.label} stayed within about ${Math.round(depthVariationDeg)}° across repetitions.`);
    const dur = reps.map((r) => r.endMs - r.startMs);
    const half = Math.floor(dur.length / 2);
    const first = dur.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const last = dur.slice(-half).reduce((a, b) => a + b, 0) / half;
    tempoTrend = last < first * 0.8 ? "faster" : last > first * 1.25 ? "slower" : "steady";
    if (tempoTrend === "faster") observations.push("Repetitions got noticeably faster toward the end of the set.");
    if (tempoTrend === "slower") observations.push("Repetitions slowed down toward the end of the set, which often happens as fatigue builds.");
  }
  let asymmetryDeg: number | null = null;
  const l = sides[0]!.map((s) => s.angle), r = sides[1]!.map((s) => s.angle);
  const diffs = l.map((v, i) => Math.abs(v - r[i]!)).filter((d) => !Number.isNaN(d));
  if (diffs.length > 10) {
    asymmetryDeg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    if (asymmetryDeg > 15) observations.push(`Left and right ${cfg.label}s differed by about ${Math.round(asymmetryDeg)}° on average in this camera view. Camera angle can cause this.`);
  }
  const limitations = [
    "Measurements come from a single camera view and are approximate.",
    "This analysis does not assess injury risk or whether a technique is safe.",
  ];
  if (trackingConfidence < 0.7) limitations.unshift("Tracking confidence was low (joints were often hidden); results may be unreliable. Film from the side with the whole body in frame.");
  return { movement, reps, repCount: reps.length, trackingConfidence, depthVariationDeg, tempoTrend, asymmetryDeg, observations, limitations };
}
