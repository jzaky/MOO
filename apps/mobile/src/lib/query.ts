import { dehydrate, hydrate, onlineManager, QueryClient, type DehydratedState } from "@tanstack/react-query";
import * as Network from "expo-network";
import { ApiError } from "./api";
import { kv } from "./storage";

/**
 * Server-state cache. Queries are persisted to on-device storage so the app
 * opens instantly and stays readable offline (recent meals, saved workouts,
 * exercise info, last diary). Writes go through the outbox, not mutations.
 */

const CACHE_KEY = "query-cache.v1";
const MAX_AGE = 7 * 24 * 3600_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: MAX_AGE,
      retry: (count, err) => (err instanceof ApiError ? err.retryable && count < 2 : count < 2),
      networkMode: "offlineFirst",
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

export function restoreCache(): void {
  const saved = kv.get<{ at: number; state: DehydratedState }>(CACHE_KEY);
  if (saved && Date.now() - saved.at < MAX_AGE) {
    try {
      hydrate(queryClient, saved.state);
    } catch {
      kv.remove(CACHE_KEY);
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function startCachePersistence(): () => void {
  const unsub = queryClient.getQueryCache().subscribe(() => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.state.status === "success" && !q.queryKey.includes("search") });
      kv.set(CACHE_KEY, { at: Date.now(), state });
    }, 1500);
  });
  return () => {
    unsub();
    if (saveTimer) clearTimeout(saveTimer);
  };
}

export function clearCache(): void {
  queryClient.clear();
  kv.remove(CACHE_KEY);
}

/** Keep TanStack Query's online state in sync with the device network. */
export function wireOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false));
    return () => sub.remove();
  });
}
