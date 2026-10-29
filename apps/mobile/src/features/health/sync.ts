import { api } from "../../lib/api";
import { qk } from "../../lib/data";
import { queryClient } from "../../lib/query";
import { kv } from "../../lib/storage";
import { healthAdapter } from "./adapter";

const STATE = "health.state";
const INITIAL_DAYS = 30;
const CHUNK = 1000;

export interface HealthSyncState {
  connected: boolean;
  lastSyncAt: string | null;
  lastResult: { received: number; inserted: number } | null;
}

export const getHealthState = (): HealthSyncState => kv.get<HealthSyncState>(STATE) ?? { connected: false, lastSyncAt: null, lastResult: null };
const setHealthState = (s: HealthSyncState) => kv.set(STATE, s);

export async function connectHealth(): Promise<boolean> {
  if (!(await healthAdapter.isAvailable())) return false;
  const ok = await healthAdapter.requestAccess();
  if (ok) setHealthState({ ...getHealthState(), connected: true });
  return ok;
}

export function disconnectHealth(): void {
  // Stops future reads from this device. Data already synced stays until the
  // user deletes it; revoking OS permission is done in the system settings.
  kv.clearPrefix("health.anchor.");
  kv.remove("health.hc.cursor");
  setHealthState({ connected: false, lastSyncAt: null, lastResult: null });
}

let running: Promise<HealthSyncState> | null = null;

/** Reads new samples from the platform store and uploads them. Single-flight. */
export function syncHealth(): Promise<HealthSyncState> {
  running ??= (async () => {
    try {
      const state = getHealthState();
      if (!state.connected || !healthAdapter.provider) return state;
      const since = new Date(Date.now() - INITIAL_DAYS * 86_400_000);
      const batch = await healthAdapter.collect(since);
      let received = 0, inserted = 0;
      for (let i = 0; i < batch.observations.length; i += CHUNK) {
        const r = await api<{ received: number; inserted: number }>("/v1/health/observations", { body: { provider: healthAdapter.provider, observations: batch.observations.slice(i, i + CHUNK) } });
        received += r.received;
        inserted += r.inserted;
      }
      batch.commit();
      const next = { connected: true, lastSyncAt: new Date().toISOString(), lastResult: { received, inserted } };
      setHealthState(next);
      if (inserted) {
        void queryClient.invalidateQueries({ queryKey: qk.recovery });
        void queryClient.invalidateQueries({ queryKey: qk.weight });
      }
      return next;
    } finally {
      running = null;
    }
  })();
  return running;
}
