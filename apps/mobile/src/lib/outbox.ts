import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { kv } from "./storage";

/**
 * Offline outbox. Every user write that must survive being offline (diary
 * entries, water, weigh-ins, workouts) is an idempotent PUT/DELETE addressed
 * by a client-generated UUID with a clientUpdatedAt timestamp. The server
 * applies last-writer-wins, so replaying an operation is always safe.
 *
 * Ops for the same path are coalesced (latest wins), so a set edited five
 * times offline is sent once. The queue persists across restarts.
 */

export interface OutboxOp {
  id: string; // dedupe key = method + path
  method: "PUT" | "DELETE" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Permanently rejected by the server (validation); kept for the user to see. */
  failed?: boolean;
}

const KEY = "outbox.v1";
let queue: OutboxOp[] = kv.get<OutboxOp[]>(KEY) ?? [];
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;
let onApplied: ((op: OutboxOp) => void) | null = null;

function persist() {
  kv.set(KEY, queue);
  listeners.forEach((l) => l());
}

export function enqueue(op: Omit<OutboxOp, "id" | "createdAt" | "attempts">): void {
  const id = `${op.method} ${op.path}`;
  queue = [...queue.filter((q) => q.id !== id), { ...op, id, createdAt: Date.now(), attempts: 0 }];
  persist();
  void flush();
}

export function setAppliedHandler(fn: (op: OutboxOp) => void): void {
  onApplied = fn;
}

export function pendingOps(): readonly OutboxOp[] {
  return queue;
}

export function useOutbox() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue,
    () => queue,
  );
}

/** Sends queued ops in order. Returns false if it stopped on a retryable failure. */
async function drain(): Promise<boolean> {
  for (const op of [...queue].sort((a, b) => a.createdAt - b.createdAt)) {
    if (op.failed) continue;
    try {
      await api(op.path, { method: op.method, body: op.body, query: op.query });
      queue = queue.filter((q) => !(q.id === op.id && q.createdAt === op.createdAt));
      persist();
      onApplied?.(op);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", String(e));
      queue = queue.map((q) => (q.id === op.id && q.createdAt === op.createdAt ? { ...q, attempts: q.attempts + 1, lastError: err.message, failed: !err.retryable && err.status !== 401 } : q));
      persist();
      if (err.retryable) return false; // offline or server trouble: stop and retry later, preserving order
    }
  }
  return true;
}

let rerun = false;

export function flush(): Promise<void> {
  if (flushing) {
    // Work enqueued during a flush is sent in the same flush, not on the next timer tick.
    rerun = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do rerun = false;
      while ((await drain()) && rerun);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function discardFailed(id: string): void {
  queue = queue.filter((q) => q.id !== id || !q.failed);
  persist();
}

export function clearOutbox(): void {
  queue = [];
  persist();
}

/** Retry with backoff while there is pending work. */
let timer: ReturnType<typeof setTimeout> | null = null;
export function startOutboxLoop(): () => void {
  let delay = 2000;
  const tick = async () => {
    if (queue.some((q) => !q.failed)) {
      const before = queue.length;
      await flush();
      delay = queue.length < before ? 2000 : Math.min(delay * 2, 60_000);
    } else delay = 5000;
    timer = setTimeout(tick, delay);
  };
  timer = setTimeout(tick, 500);
  return () => {
    if (timer) clearTimeout(timer);
  };
}
