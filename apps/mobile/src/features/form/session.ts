import { analyzeMovement, type Frame, type MovementAnalysis, type MovementKind } from "@stoke/core";
import type { PoseFrame } from "./types";

/**
 * Turns frames from the pose page into the core analysis input. Runs entirely
 * on the device with the same @stoke/core analysis the API exposes.
 */

export const MIN_TRACKED_FRAMES = 10;

export function toCoreFrames(frames: readonly PoseFrame[]): Frame[] {
  // Frames with nobody in view become empty, which the analysis treats as gaps.
  return frames.map((f) => ({ tMs: f.t, landmarks: f.lm ? f.lm.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : [] }));
}

export function trackedFrameCount(frames: readonly PoseFrame[]): number {
  return frames.filter((f) => f.lm).length;
}

export function analyzeSession(movement: MovementKind, frames: readonly PoseFrame[]): MovementAnalysis | null {
  if (trackedFrameCount(frames) < MIN_TRACKED_FRAMES) return null;
  return analyzeMovement(movement, toCoreFrames(frames));
}
