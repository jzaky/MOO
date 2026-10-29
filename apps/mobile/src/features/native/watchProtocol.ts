import type { WatchAction } from "./types";

/** Validates an action received from the watch (untrusted JSON string or object). */
export function parseWatchAction(raw: unknown): WatchAction | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type === "complete_set" && typeof o.exerciseRowId === "string" && o.exerciseRowId && typeof o.setId === "string" && o.setId) {
    return { type: "complete_set", exerciseRowId: o.exerciseRowId, setId: o.setId };
  }
  return null;
}
