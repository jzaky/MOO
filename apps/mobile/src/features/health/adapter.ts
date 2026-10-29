import type { HealthAdapter } from "./types";

/**
 * Fallback for platforms without a health store (web, simulators without
 * HealthKit). Metro picks adapter.ios.ts / adapter.android.ts on device.
 */
export const healthAdapter: HealthAdapter = {
  provider: null,
  name: "Health data",
  reads: [],
  isAvailable: async () => false,
  requestAccess: async () => false,
  collect: async () => ({ observations: [], commit: () => {} }),
};
