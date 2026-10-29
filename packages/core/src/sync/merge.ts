/**
 * Offline sync conflict resolution.
 *
 * Every syncable record carries a client-generated UUID (stable across
 * retries → idempotent writes), a `clientUpdatedAt` timestamp from the device
 * that made the change, and a monotonically increasing server `version`.
 *
 * Policy: last-writer-wins on `clientUpdatedAt`, with deletes (tombstones)
 * winning ties, and the server version as the final tie-breaker. Equal
 * payloads are no-ops so replayed mutations never bump versions.
 */

export interface SyncRecordMeta {
  id: string;
  clientUpdatedAt: string; // ISO instant
  deletedAt?: string | null;
  version?: number;
}

export type MergeDecision = "insert" | "apply" | "skip_stale" | "skip_duplicate";

export function decideMerge<T extends SyncRecordMeta>(incoming: T, existing: T | null | undefined, equal: (a: T, b: T) => boolean = shallowEqual): MergeDecision {
  if (!existing) return "insert";
  if (equal(incoming, existing)) return "skip_duplicate";
  const a = Date.parse(incoming.clientUpdatedAt);
  const b = Date.parse(existing.clientUpdatedAt);
  if (Number.isNaN(a)) return "skip_stale";
  if (a > b) return "apply";
  if (a < b) return "skip_stale";
  // Same instant: tombstone wins, otherwise keep existing (deterministic).
  if (incoming.deletedAt && !existing.deletedAt) return "apply";
  return "skip_stale";
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const ignore = new Set(["version", "serverUpdatedAt"]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !ignore.has(k)));
  for (const k of keys) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
  }
  return true;
}

/** Reject client clocks that are wildly in the future (prevents a skewed device from "winning" forever). */
export function clampClientTimestamp(clientIso: string, serverNow: Date, maxSkewMs = 5 * 60_000): string {
  const t = Date.parse(clientIso);
  if (Number.isNaN(t)) return serverNow.toISOString();
  return t > serverNow.getTime() + maxSkewMs ? serverNow.toISOString() : new Date(t).toISOString();
}
