import { getSdkStatus, initialize, openHealthConnectSettings, readRecords, requestPermission, SdkAvailabilityStatus, SleepStageType } from "react-native-health-connect";
import type { RecordType } from "react-native-health-connect";
import { kv } from "../../lib/storage";
import type { HealthAdapter, HealthObservation } from "./types";

/**
 * Health Connect has no per-type anchor for reads, so each sync re-reads a
 * window starting slightly before the last successful sync. The server
 * deduplicates on the record id, so the overlap is harmless.
 *
 * Not read: HRV (Health Connect reports RMSSD, which is not comparable to
 * the SDNN values HealthKit provides) and Distance (not limited to walking).
 */
const RECORDS = ["Steps", "ActiveCaloriesBurned", "RestingHeartRate", "Weight", "SleepSession"] as const satisfies readonly RecordType[];
const ASLEEP = new Set<number>([SleepStageType.SLEEPING, SleepStageType.LIGHT, SleepStageType.DEEP, SleepStageType.REM]);
const CURSOR = "health.hc.cursor";
const OVERLAP_MS = 2 * 86_400_000;

async function ready(): Promise<boolean> {
  if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) return false;
  return initialize();
}

async function readAll<T extends RecordType>(type: T, startTime: string) {
  const records = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(type, { timeRangeFilter: { operator: "after", startTime }, pageSize: 1000, pageToken });
    records.push(...page.records);
    pageToken = page.pageToken || undefined;
  } while (pageToken && records.length < 10_000);
  return records;
}

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

export const healthAdapter: HealthAdapter = {
  provider: "health_connect",
  name: "Health Connect",
  reads: ["Steps", "Active calories", "Resting heart rate", "Body weight", "Sleep"],
  isAvailable: async () => (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE,
  async requestAccess() {
    if (!(await ready())) return false;
    const granted = await requestPermission(RECORDS.map((recordType) => ({ accessType: "read" as const, recordType })));
    return granted.length > 0;
  },
  async collect(since) {
    if (!(await ready())) return { observations: [], commit: () => {} };
    const startedAt = new Date();
    const cursor = kv.get<string>(CURSOR);
    const from = new Date(Math.max(since.getTime(), cursor ? Date.parse(cursor) - OVERLAP_MS : 0)).toISOString();
    const out: HealthObservation[] = [];
    const src = (m?: { dataOrigin?: string }) => m?.dataOrigin?.slice(0, 120);

    for (const r of await readAll("Steps", from)) if (r.metadata?.id) out.push({ sourceRecordId: r.metadata.id, type: "steps", startAt: r.startTime, endAt: r.endTime, value: r.count, sourceName: src(r.metadata) });
    for (const r of await readAll("ActiveCaloriesBurned", from)) if (r.metadata?.id) out.push({ sourceRecordId: r.metadata.id, type: "active_energy_kcal", startAt: r.startTime, endAt: r.endTime, value: r.energy.inKilocalories, sourceName: src(r.metadata) });
    for (const r of await readAll("RestingHeartRate", from)) if (r.metadata?.id) out.push({ sourceRecordId: r.metadata.id, type: "resting_hr", startAt: r.time, endAt: r.time, value: r.beatsPerMinute, sourceName: src(r.metadata) });
    for (const r of await readAll("Weight", from)) if (r.metadata?.id) out.push({ sourceRecordId: r.metadata.id, type: "body_mass_kg", startAt: r.time, endAt: r.time, value: r.weight.inKilograms, sourceName: src(r.metadata) });
    for (const r of await readAll("SleepSession", from)) {
      if (!r.metadata?.id) continue;
      // With stages, count only asleep stages; without, the session length is the best available figure.
      const minutes = r.stages?.length ? r.stages.filter((s) => ASLEEP.has(s.stage)).reduce((sum, s) => sum + minutesBetween(s.startTime, s.endTime), 0) : minutesBetween(r.startTime, r.endTime);
      if (minutes > 0) out.push({ sourceRecordId: r.metadata.id, type: "sleep_minutes", startAt: r.startTime, endAt: r.endTime, value: Math.round(minutes * 10) / 10, sourceName: src(r.metadata) });
    }
    return { observations: out.filter((o) => Number.isFinite(o.value) && o.value >= 0), commit: () => kv.set(CURSOR, startedAt.toISOString()) };
  },
  openSystemSettings: () => openHealthConnectSettings(),
};
