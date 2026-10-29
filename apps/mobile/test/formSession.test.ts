import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSession, MIN_TRACKED_FRAMES, toCoreFrames } from "../src/features/form/session";
import type { PoseFrame } from "../src/features/form/types";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "../../../packages/core/test/fixtures/squat-real-landmarks.json"), "utf8")) as { frames: PoseFrame[]; groundTruth: { completedReps: number } };

describe("form check session", () => {
  it("analyses frames exactly as the pose page posts them", () => {
    expect(analyzeSession("squat", fixture.frames)?.repCount).toBe(fixture.groundTruth.completedReps);
  });

  it("treats frames without a person as gaps", () => {
    const withGaps: PoseFrame[] = [...fixture.frames.slice(0, 20), { t: 99_999, lm: null }];
    expect(toCoreFrames(withGaps).at(-1)!.landmarks).toEqual([]);
  });

  it("refuses to analyse a set that was barely tracked", () => {
    expect(analyzeSession("squat", fixture.frames.slice(0, MIN_TRACKED_FRAMES - 1))).toBeNull();
    expect(analyzeSession("squat", fixture.frames.map((f) => ({ ...f, lm: null })))).toBeNull();
  });
});
