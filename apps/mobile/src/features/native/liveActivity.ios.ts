import type { LiveActivity } from "expo-widgets";
import { WORKOUT_START_URL } from "./deepLinks";
import type { RestActivityInput, RestActivityProps } from "./types";
import RestTimer from "./widgets/RestActivity";

export type { RestActivityInput } from "./types";

/*
 * Rest-timer Live Activity (iOS, expo-widgets). One activity at a time:
 * starting while one is running updates it instead. All calls are
 * fire-and-forget and never throw (the user may have Live Activities turned
 * off, or the device may not support them).
 */

let current: LiveActivity<RestActivityProps> | null = null;
let startedAt: number | null = null;

const warn = (what: string) => (e: unknown) => {
  if (__DEV__) console.warn(`[liveActivity] ${what} failed`, e);
};

function running(): LiveActivity<RestActivityProps>[] {
  try {
    return RestTimer.getInstances();
  } catch {
    return [];
  }
}

function props(input: RestActivityInput): RestActivityProps {
  return { endsAt: input.endsAt, exerciseName: input.exerciseName, setLabel: input.setLabel, startedAt: Math.min(startedAt ?? Date.now(), input.endsAt) };
}

export function startRestActivity(input: RestActivityInput): void {
  startedAt = Date.now();
  const existing = current ?? running()[0] ?? null;
  if (existing) {
    current = existing;
    existing.update(props(input), new Date(input.endsAt)).catch(warn("update"));
    return;
  }
  try {
    current = RestTimer.start(props(input), WORKOUT_START_URL, new Date(input.endsAt));
  } catch (e) {
    current = null;
    warn("start")(e);
  }
}

export function updateRestActivity(input: RestActivityInput): void {
  const existing = current ?? running()[0] ?? null;
  if (!existing) return startRestActivity(input);
  current = existing;
  existing.update(props(input), new Date(input.endsAt)).catch(warn("update"));
}

export function endRestActivity(): void {
  const all = new Set([...(current ? [current] : []), ...running()]);
  current = null;
  startedAt = null;
  for (const a of all) a.end("immediate").catch(warn("end"));
}
