import { requireOptionalNativeModule, type NativeModule } from "expo";
import type { WatchAction, WatchWorkoutState } from "./types";
import { parseWatchAction } from "./watchProtocol";

export type { WatchAction, WatchWorkoutState } from "./types";

type WatchEvents = { onWatchAction: (event: { action: string }) => void };

/** Native side: `modules/stoke-watch` (WatchConnectivity). */
declare class StokeWatchModule extends NativeModule<WatchEvents> {
  /** Sends the JSON-encoded state (or "null") to the watch as the latest application context. */
  sendWorkoutState(json: string): void;
}

// Optional: absent in Expo Go or when the module isn't linked; every call then does nothing.
const native = requireOptionalNativeModule<StokeWatchModule>("StokeWatch");

let lastSent: string | null = null;

/** Mirrors the live workout to the watch. `null` tells the watch there is no workout. Deduplicated. */
export function sendWorkoutState(state: WatchWorkoutState | null): void {
  if (!native) return;
  const json = JSON.stringify(state);
  if (json === lastSent) return;
  try {
    native.sendWorkoutState(json);
    lastSent = json;
  } catch (e) {
    if (__DEV__) console.warn("[watch] sendWorkoutState failed", e);
  }
}

/** Subscribes to actions from the watch (for example "complete_set"). Invalid payloads are dropped. */
export function onWatchAction(listener: (action: WatchAction) => void): { remove(): void } {
  if (!native) return { remove() {} };
  const sub = native.addListener("onWatchAction", (event) => {
    const action = parseWatchAction(event?.action);
    if (action) listener(action);
  });
  return { remove: () => sub.remove() };
}
