import { analyzeMovement, type Frame, type MovementAnalysis, type MovementKind } from "@moo/core";
import type { PoseFrame } from "./types";

/**
 * Turns frames from the pose page into the core analysis input. Runs entirely
 * on the device with the same @moo/core analysis the API exposes.
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

export const MOVEMENT_GUIDE: Record<MovementKind, { label: string; setup: string; measures: string }> = {
  squat: { label: "Squat", setup: "Stand side-on to the camera, 2–3 m away, with your whole body in frame. Prop the phone at about hip height.", measures: "knee angle at the bottom of each rep" },
  push_up: { label: "Push-up", setup: "Place the phone on the floor side-on, 1.5–2 m away, so your head, hands and feet are all in frame.", measures: "elbow angle at the bottom of each rep" },
};
