import { addDays, isoWeekday, type DayKey } from "../time";

/**
 * Notification planner. Pure: given preferences, the user's time zone and
 * schedule facts, returns the reminders to send in a window. Respects quiet
 * hours and uses neutral, non-guilt wording.
 */

export interface NotificationPrefs {
  workoutReminders: boolean;
  mealReminders: boolean;
  hydrationReminders: boolean;
  weeklySummary: boolean;
  checkIns: boolean;
  quietStart: string; // "22:00"
  quietEnd: string; // "07:00"
}

export interface PlannerFacts {
  timeZone: string;
  /** Training weekdays (ISO 1–7) with planned workout names. */
  plannedWorkouts: { weekday: number; name: string }[];
  /** Local times (HH:MM) for meal reminders. */
  mealTimes?: { meal: string; time: string }[];
  /** Days that already have a completed workout (skip reminders). */
  completedWorkoutDays?: DayKey[];
  /** Days with food already logged per meal ("2026-10-28:breakfast"). */
  loggedMeals?: string[];
}

export interface PlannedNotification {
  key: string; // stable idempotency key
  kind: "workout" | "meal" | "hydration" | "weekly_summary" | "check_in";
  localDay: DayKey;
  localTime: string;
  title: string;
  body: string;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export function inQuietHours(localTime: string, quietStart: string, quietEnd: string): boolean {
  const t = toMin(localTime), s = toMin(quietStart), e = toMin(quietEnd);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Move a time out of quiet hours to the quiet-hours end, if needed. */
export function shiftOutOfQuietHours(localTime: string, quietStart: string, quietEnd: string): string {
  return inQuietHours(localTime, quietStart, quietEnd) ? quietEnd : localTime;
}

export function planNotifications(prefs: NotificationPrefs, facts: PlannerFacts, fromDay: DayKey, days = 7): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const done = new Set(facts.completedWorkoutDays ?? []);
  const logged = new Set(facts.loggedMeals ?? []);
  const q = (t: string) => shiftOutOfQuietHours(t, prefs.quietStart, prefs.quietEnd);
  for (let i = 0; i < days; i++) {
    const day = addDays(fromDay, i);
    const wd = isoWeekday(day);
    if (prefs.workoutReminders && !done.has(day)) {
      for (const w of facts.plannedWorkouts.filter((p) => p.weekday === wd)) {
        out.push({ key: `workout:${day}`, kind: "workout", localDay: day, localTime: q("17:00"), title: `${w.name} is planned today`, body: "Your session is ready when you are. Short on time? You can start a shortened version." });
      }
    }
    if (prefs.mealReminders) {
      for (const m of facts.mealTimes ?? []) {
        if (logged.has(`${day}:${m.meal}`)) continue;
        out.push({ key: `meal:${day}:${m.meal}`, kind: "meal", localDay: day, localTime: q(m.time), title: `Log ${m.meal}?`, body: "Tap to add it from your recent foods." });
      }
    }
    if (prefs.hydrationReminders) {
      for (const t of ["11:00", "15:00"]) out.push({ key: `water:${day}:${t}`, kind: "hydration", localDay: day, localTime: q(t), title: "Water check", body: "A quick reminder to drink some water." });
    }
    if (prefs.checkIns) out.push({ key: `checkin:${day}`, kind: "check_in", localDay: day, localTime: q("08:30"), title: "How are you feeling today?", body: "A 5-second check-in helps tailor today's training." });
    if (prefs.weeklySummary && wd === 1) out.push({ key: `weekly:${day}`, kind: "weekly_summary", localDay: day, localTime: q("09:00"), title: "Your weekly review is ready", body: "See last week's nutrition, training and trend in one place." });
  }
  return out;
}

/** UTC instant for a local wall-clock time in an IANA zone (DST-safe via iteration). */
export function localTimeToUtc(day: DayKey, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  let guess = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    const target = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m);
    const diff = target - asIfUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
