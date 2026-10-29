/**
 * Calendar-day helpers. A "day key" is an ISO date string (YYYY-MM-DD) in the
 * user's own time zone. All logs are stored with a UTC instant AND the day key
 * computed at write time, so moving time zones never reshuffles history.
 */

export type DayKey = string;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(s: string): s is DayKey {
  if (!DAY_KEY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Day key for an instant in an IANA time zone (e.g. "Asia/Dubai"). */
export function dayKeyInZone(instant: Date, timeZone: string): DayKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dayKeyToUtcDate(key: DayKey): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function addDays(key: DayKey, days: number): DayKey {
  const d = dayKeyToUtcDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((dayKeyToUtcDate(b).getTime() - dayKeyToUtcDate(a).getTime()) / 86_400_000);
}

export function dayRange(start: DayKey, endInclusive: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = start; k <= endInclusive; k = addDays(k, 1)) out.push(k);
  return out;
}

/** ISO weekday 1 (Mon) .. 7 (Sun). */
export function isoWeekday(key: DayKey): number {
  const d = dayKeyToUtcDate(key).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the ISO week containing `key`. */
export function startOfIsoWeek(key: DayKey): DayKey {
  return addDays(key, 1 - isoWeekday(key));
}

/** Minutes since local midnight for an instant in a zone (for quiet hours etc.). */
export function minutesOfDayInZone(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
