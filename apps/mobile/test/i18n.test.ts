import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { storageMock } from "./mocks";

vi.mock("../src/lib/storage", () => storageMock);
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "en" }] }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, I18nManager: { isRTL: false, allowRTL: () => {}, forceRTL: () => {} } }));

const { AR, AR_AREAS } = await import("../src/i18n/ar");
const { arabicPlural, translate, translateCount } = await import("../src/i18n");

const SRC = path.resolve(__dirname, "../src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });
}

// String literals passed to t("...") and the plural (last) literal of tn(n, "...", "...").
const literal = String.raw`"((?:[^"\\]|\\.)*)"`;
const T_CALL = new RegExp(String.raw`\bt\(\s*` + literal, "g");
const TN_CALL = new RegExp(String.raw`\btn\([^,]+,\s*` + literal + String.raw`\s*,\s*` + literal, "g");
const unescape = (s: string) => JSON.parse(`"${s}"`) as string;

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of files(SRC)) {
    if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(T_CALL)) keys.set(unescape(m[1]!), path.relative(SRC, f));
    for (const m of src.matchAll(TN_CALL)) keys.set(unescape(m[2]!), path.relative(SRC, f));
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Arabic translations", () => {
  it("covers every string the app translates", () => {
    const missing = [...usedKeys()].filter(([k]) => !(k in AR)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps the same {placeholders} as the English", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(AR)) {
      const forms = typeof v === "string" ? [v] : Object.values(v);
      const want = placeholders(k).filter((p) => p !== "n");
      for (const f of forms) {
        const got = placeholders(f!).filter((p) => p !== "n");
        if (JSON.stringify([...new Set(got)]) !== JSON.stringify([...new Set(want)])) bad.push(`${k} → ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("defines each key in one area only", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [area, dict] of Object.entries(AR_AREAS)) for (const k of Object.keys(dict)) seen.has(k) ? dupes.push(`${k} (${seen.get(k)}, ${area})`) : seen.set(k, area);
    expect(dupes).toEqual([]);
  });
});

describe("translation helpers", () => {
  const dict = { "Start workout": "ابدأ التمرين", "{n} sets": { zero: "لا مجموعات", one: "مجموعة واحدة", two: "مجموعتان", few: "{n} مجموعات", many: "{n} مجموعة", other: "{n} مجموعة" } };
  it("falls back to English and interpolates", () => {
    expect(translate(dict, "ar", "Start workout")).toBe("ابدأ التمرين");
    expect(translate(dict, "ar", "Untranslated {x}", { x: 1 })).toBe("Untranslated 1");
    expect(translate(dict, "en", "Start workout")).toBe("Start workout");
  });
  it("uses Arabic plural categories", () => {
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102].map(arabicPlural)).toEqual(["zero", "one", "two", "few", "few", "many", "many", "other", "other"]);
    expect(translateCount(dict, "ar", 2, "{n} set", "{n} sets")).toBe("مجموعتان");
    expect(translateCount(dict, "ar", 5, "{n} set", "{n} sets")).toBe("5 مجموعات");
    expect(translateCount(dict, "en", 1, "{n} set", "{n} sets")).toBe("1 set");
  });
});
