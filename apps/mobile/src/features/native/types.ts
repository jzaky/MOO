/**
 * Shared, platform-neutral types for the native surfaces (home-screen widgets,
 * the rest-timer Live Activity and the Apple Watch companion). Everything here
 * is plain JSON so it can cross the native bridge, WatchConnectivity and the
 * widget runtime without custom serialization.
 */

/** What the app knows about today, as handed to `updateWidgets`. */
export interface WidgetSnapshot {
  /** Local day the numbers belong to (YYYY-MM-DD). */
  day: string;
  kcalEaten: number;
  kcalTarget: number | null;
  proteinEatenG: number;
  proteinTargetG: number | null;
  /** The session to show on the "Next workout" widget, if any. */
  workout: { name: string; status: "in_progress" | "today" | "next" } | null;
}

/** Props of the "Calories left" widget (must stay JSON-serializable). */
export interface CaloriesWidgetProps {
  /** null when no target is set or the data belongs to a previous day. */
  kcalLeft: number | null;
  kcalTarget: number | null;
  proteinLeftG: number | null;
  /** Eaten / target, clamped to 0…1, for the ring. */
  progress: number;
  /** True when the numbers are from a previous day (shown after midnight until the app refreshes). */
  stale: boolean;
}

/** Props of the "Next workout" widget (must stay JSON-serializable). */
export interface NextWorkoutWidgetProps {
  name: string | null;
  /** "In progress", "Today", "Next up" or "No plan yet". */
  label: string;
  inProgress: boolean;
}

/** Input of `startRestActivity` / `updateRestActivity`. */
export interface RestActivityInput {
  /** When the rest ends, epoch milliseconds. */
  endsAt: number;
  exerciseName: string;
  /** For example "Set 3 of 4". */
  setLabel: string;
}

/** Props of the rest-timer Live Activity (what the widget runtime receives). */
export interface RestActivityProps extends RestActivityInput {
  /** When the countdown started, epoch milliseconds (lower bound of the system timer). */
  startedAt: number;
}

/**
 * The workout state mirrored to the Apple Watch. Kept deliberately small: the
 * watch only shows the current exercise, the next set and the rest countdown.
 */
export interface WatchWorkoutState {
  v: 1;
  workoutId: string;
  workoutName: string;
  exerciseRowId: string | null;
  exerciseName: string | null;
  /** The next set to do (null when every set is done). */
  setId: string | null;
  setLabel: string | null;
  weightKg: number | null;
  reps: number | null;
  /** Rest end, epoch milliseconds, or null when not resting. */
  restEndsAt: number | null;
  completedSets: number;
  totalSets: number;
}

/** Actions the watch can send back to the phone. */
export type WatchAction = { type: "complete_set"; exerciseRowId: string; setId: string };
