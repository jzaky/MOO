import * as Crypto from "expo-crypto";
import { dayKeyInZone } from "@stoke/core";
import { fmtDayLabel } from "../i18n";

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
  return fmtDayLabel(day, today);
}
