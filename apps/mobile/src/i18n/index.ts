import { useSyncExternalStore } from "react";
import { kv } from "../lib/storage";
import { AR } from "./ar";

/**
 * UI language. English text is the key: `t("Start workout")` looks the string
 * up in the Arabic dictionary and falls back to the English. Variables use
 * `{name}`. Counts go through `tn`, which applies Arabic's six plural forms.
 *
 * Arabic switches layout to right-to-left. On the web that is immediate; on
 * iOS and Android the system applies a direction change on the next launch,
 * so the text switches now and the layout after a restart.
 */

export type Lang = "en" | "ar";
export type LangSetting = "system" | Lang;
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };
export type Dict = Record<string, string | PluralForms>;

const KEY = "settings.language";

// Native modules are required lazily so plain-Node unit tests can import modules that translate text.
type RN = typeof import("react-native");
const rn = (): RN => require("react-native") as RN;
const listeners = new Set<() => void>();

function systemLang(): Lang {
  try {
    const { getLocales } = require("expo-localization") as typeof import("expo-localization");
    return getLocales()[0]?.languageCode === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export function getLanguageSetting(): LangSetting {
  return kv.get<LangSetting>(KEY) ?? "system";
}

let lang: Lang = resolveLang(getLanguageSetting());

function resolveLang(s: LangSetting): Lang {
  return s === "system" ? systemLang() : s;
}

export function currentLang(): Lang {
  return lang;
}

export function isRTL(): boolean {
  return lang === "ar";
}

/** Locale for Intl formatting. Arabic keeps Western digits, as most UAE apps and food labels do. */
export function locale(): string | undefined {
  return lang === "ar" ? "ar-AE-u-nu-latn" : undefined;
}

/** Apply the current direction to the platform. Call once at startup and after a change. */
export function applyDirection(): void {
  const rtl = isRTL();
  const { I18nManager, Platform } = rn();
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    return;
  }
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(rtl);
}

/** Change language. Returns whether the native layout direction needs an app restart to follow. */
export function setLanguage(setting: LangSetting): { needsRestart: boolean } {
  kv.set(KEY, setting);
  lang = resolveLang(setting);
  applyDirection();
  for (const l of listeners) l();
  const { I18nManager, Platform } = rn();
  return { needsRestart: Platform.OS !== "web" && I18nManager.isRTL !== isRTL() };
}

/** Re-render when the language changes (the root layout keys the navigator on this). */
export function useLanguage(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
    () => lang,
  );
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** CLDR plural category for Arabic. */
export function arabicPlural(n: number): PluralCategory {
  if (!Number.isInteger(n)) return "other";
  const m = Math.abs(n) % 100;
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n === 2) return "two";
  if (m >= 3 && m <= 10) return "few";
  if (m >= 11 && m <= 99) return "many";
  return "other";
}

export function translate(dict: Dict, language: Lang, en: string, vars?: Record<string, string | number>): string {
  const d = language === "ar" ? dict[en] : undefined;
  const s = typeof d === "string" ? d : d ? d.other : en;
  return interpolate(s, vars);
}

export function translateCount(dict: Dict, language: Lang, n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const all = { n, ...vars };
  if (language === "ar") {
    const d = dict[other];
    if (typeof d === "string") return interpolate(d, all);
    if (d) return interpolate(d[arabicPlural(n)] ?? d.other, all);
  }
  return interpolate(n === 1 ? one : other, all);
}

/** Translate a UI string. The English text is the key. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return translate(AR, lang, en, vars);
}

/** Count-dependent text: `tn(sets, "{n} set", "{n} sets")`. The Arabic entry is keyed by the English plural. */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return translateCount(AR, lang, n, one, other, vars);
}

/** Short date like "Oct 29" / "٢٩ أكتوبر" (with Western digits) from a YYYY-MM-DD day. */
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale(), { ...opts, timeZone: "UTC" });
}

/** "Today", "Yesterday", "Tomorrow" or a short weekday date, from YYYY-MM-DD keys. */
export function fmtDayLabel(day: string, today: string): string {
  if (day === today) return t("Today");
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000);
  if (diff === 1) return t("Yesterday");
  if (diff === -1) return t("Tomorrow");
  return fmtDay(day, { weekday: "short", month: "short", day: "numeric" });
}

/** Number with grouping in the current locale. */
export function fmtNum(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString(locale(), { maximumFractionDigits: maxFractionDigits });
}
