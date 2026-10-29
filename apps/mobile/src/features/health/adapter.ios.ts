import {
  CategoryValueSleepAnalysis,
  isHealthDataAvailableAsync,
  queryCategorySamplesWithAnchor,
  queryQuantitySamplesWithAnchor,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import { Linking } from "react-native";
import { kv } from "../../lib/storage";
import type { HealthAdapter, HealthObservation, HealthObservationType } from "./types";

/** HealthKit quantity types this app reads, with the unit requested from HealthKit. */
const QUANTITIES = [
  { id: "HKQuantityTypeIdentifierStepCount", unit: "count", type: "steps" },
  { id: "HKQuantityTypeIdentifierActiveEnergyBurned", unit: "kcal", type: "active_energy_kcal" },
  { id: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min", type: "resting_hr" },
  { id: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", unit: "ms", type: "hrv_sdnn_ms" },
  { id: "HKQuantityTypeIdentifierDistanceWalkingRunning", unit: "m", type: "walking_distance_m" },
  { id: "HKQuantityTypeIdentifierBodyMass", unit: "kg", type: "body_mass_kg" },
] as const satisfies readonly { id: string; unit: string; type: HealthObservationType }[];
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis" as const;
// "In bed" and "awake" samples are not sleep.
const ASLEEP = new Set<number>([CategoryValueSleepAnalysis.asleepUnspecified, CategoryValueSleepAnalysis.asleepCore, CategoryValueSleepAnalysis.asleepDeep, CategoryValueSleepAnalysis.asleepREM]);
const anchorKey = (id: string) => `health.anchor.${id}`;
const LIMIT = 2000;

export const healthAdapter: HealthAdapter = {
  provider: "healthkit",
  name: "Apple Health",
  reads: ["Steps", "Active energy", "Resting heart rate", "Heart rate variability", "Walking + running distance", "Body weight", "Sleep"],
  isAvailable: () => isHealthDataAvailableAsync(),
  async requestAccess() {
    return requestAuthorization({ toRead: [...QUANTITIES.map((q) => q.id), SLEEP] });
  },
  async collect(since) {
    const out: HealthObservation[] = [];
    const anchors: Record<string, string> = {};
    // An anchor returns only samples added since the last successful sync; the
    // first sync is bounded by `since` so we never pull years of history.
    const filter = { date: { startDate: since } };
    for (const q of QUANTITIES) {
      const anchor = kv.get<string>(anchorKey(q.id)) ?? undefined;
      const res = await queryQuantitySamplesWithAnchor(q.id, { anchor, limit: LIMIT, unit: q.unit, ...(anchor ? {} : { filter }) });
      anchors[q.id] = res.newAnchor;
      for (const s of res.samples) {
        if (!(s.quantity >= 0)) continue;
        out.push({ sourceRecordId: s.uuid, type: q.type, startAt: s.startDate.toISOString(), endAt: s.endDate.toISOString(), value: s.quantity, sourceName: s.sourceRevision?.source.name?.slice(0, 120) });
      }
    }
    const anchor = kv.get<string>(anchorKey(SLEEP)) ?? undefined;
    const sleep = await queryCategorySamplesWithAnchor(SLEEP, { anchor, limit: LIMIT, ...(anchor ? {} : { filter }) });
    anchors[SLEEP] = sleep.newAnchor;
    // Phone and watch can both record the same night; the server totals each
    // source separately and keeps the most complete one per day.
    for (const s of sleep.samples) {
      if (!ASLEEP.has(Number(s.value))) continue;
      const minutes = (s.endDate.getTime() - s.startDate.getTime()) / 60_000;
      if (minutes <= 0) continue;
      out.push({ sourceRecordId: s.uuid, type: "sleep_minutes", startAt: s.startDate.toISOString(), endAt: s.endDate.toISOString(), value: Math.round(minutes * 10) / 10, sourceName: s.sourceRevision?.source.name?.slice(0, 120) });
    }
    return {
      observations: out,
      commit: () => Object.entries(anchors).forEach(([id, a]) => kv.set(anchorKey(id), a)),
    };
  },
  openSystemSettings: () => void Linking.openURL("x-apple-health://").catch(() => Linking.openSettings()),
};
