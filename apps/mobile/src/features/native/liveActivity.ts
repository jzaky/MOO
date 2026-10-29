import type { RestActivityInput } from "./types";

export type { RestActivityInput } from "./types";

/*
 * Rest-timer Live Activity. Live Activities exist only on iOS; this is the
 * Android and web variant (no-ops). See `liveActivity.ios.ts`.
 */

export function startRestActivity(_input: RestActivityInput): void {}

export function updateRestActivity(_input: RestActivityInput): void {}

export function endRestActivity(): void {}
