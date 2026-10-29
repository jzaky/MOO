import * as Crypto from "expo-crypto";
import { dayKeyInZone } from "@moo/core";

export const uuid = (): string => Crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function todayKey(tz = deviceTimeZone()): string {
  return dayKeyInZone(new Date(), tz);
}

export function formatDayLabel(day: string, today = todayKey()): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
