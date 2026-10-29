/** Shape accepted by POST /v1/health/observations (see @moo/contracts HealthIngestRequest). */
export type HealthObservationType = "steps" | "active_energy_kcal" | "resting_hr" | "hrv_sdnn_ms" | "sleep_minutes" | "walking_distance_m" | "body_mass_kg" | "workout_minutes";

export interface HealthObservation {
  sourceRecordId: string;
  type: HealthObservationType;
  startAt: string;
  endAt: string;
  value: number;
  sourceName?: string;
}

export interface HealthBatch {
  observations: HealthObservation[];
  /** Persist read cursors. Call only after the server accepted the batch. */
  commit(): void;
}

export interface HealthAdapter {
  provider: "healthkit" | "health_connect" | null;
  /** User-facing name of the platform store. */
  name: string;
  /** Data this app reads, for the permission explainer. */
  reads: string[];
  isAvailable(): Promise<boolean>;
  /** Shows the system permission sheet. Read permission results are not disclosed on iOS, so `true` means "asked". */
  requestAccess(): Promise<boolean>;
  collect(since: Date): Promise<HealthBatch>;
  openSystemSettings?(): void;
}
