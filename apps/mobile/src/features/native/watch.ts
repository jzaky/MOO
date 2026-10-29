import type { WatchAction, WatchWorkoutState } from "./types";

export type { WatchAction, WatchWorkoutState } from "./types";

/*
 * Apple Watch companion bridge. The watch app exists only on iOS; this is the
 * Android and web variant (no-ops). See `watch.ios.ts`.
 */

export function sendWorkoutState(_state: WatchWorkoutState | null): void {}

export function onWatchAction(_listener: (action: WatchAction) => void): { remove(): void } {
  return { remove() {} };
}
