import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeMovement, standingThreshold, type Frame } from "../src";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, "fixtures/squat-real-landmarks.json"), "utf8")) as { groundTruth: { completedReps: number }; frames: { t: number; lm: number[][] | null }[] };
const frames: Frame[] = fixture.frames.map((f) => ({ tMs: f.t, landmarks: f.lm ? f.lm.map(([x, y, z, visibility]) => ({ x: x!, y: y!, z: z!, visibility: visibility! })) : [] }));

describe("rep counting on a real recorded set", () => {
  it("counts every completed squat, including reps where the lifter does not fully straighten", () => {
    const a = analyzeMovement("squat", frames);
    expect(a.repCount).toBe(fixture.groundTruth.completedReps);
    for (const r of a.reps) {
      expect(r.minAngle).toBeLessThan(100);
      expect(r.endMs - r.startMs).toBeGreaterThan(1500);
      expect(r.endMs - r.startMs).toBeLessThan(4000);
    }
    expect(a.trackingConfidence).toBeGreaterThan(0.7);
  });
});

describe("standing threshold", () => {
  it("adapts to the person's own standing angle but never drops near the bottom", () => {
    expect(standingThreshold([165, 163, 150, 120, 95, 160, 164], 160, 110)).toBe(155);
    expect(standingThreshold([178, 176, 100, 177], 160, 110)).toBe(160);
    expect(standingThreshold([120, 118, 100], 160, 110)).toBe(135);
    expect(standingThreshold([NaN], 160, 110)).toBe(160);
  });
});
