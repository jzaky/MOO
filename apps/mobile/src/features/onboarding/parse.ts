/**
 * Lenient reading of what people type on a phone, so onboarding never sends
 * a value the server will reject: decimal commas, "15%", height in metres,
 * and times like "11pm" or "23.00".
 */

/** "82,5" → 82.5, "15 %" → 15. NaN when there is no number. */
export function parseNumber(s: string): number {
  const cleaned = s.trim().replace(/\s|%/g, "").replace(",", ".");
  return cleaned === "" ? NaN : Number(cleaned);
}

/** Centimetres from a metric height entry; "1.78" (metres) becomes 178. */
export function metricHeightCm(s: string): number {
  const n = parseNumber(s);
  return n > 0 && n < 3 ? Math.round(n * 1000) / 10 : n;
}

/** "11pm" → "23:00", "7:30 am" → "07:30", "23.00" → "23:00", "2300" → "23:00", "7" → "07:00". Null if it isn't a time. */
export function normalizeTime(s: string): string | null {
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a|p)?\.?\s*$/i.exec(s.replace(/ /g, " "));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith("p") && h !== 12) h += 12;
    if (ap.startsWith("a") && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export type BodyProblem = "birth_date" | "age" | "height" | "weight" | "body_fat";

/** What's wrong with the body step, in the server's own limits (contracts OnboardingPlanRequest). */
export function bodyProblems(v: { birthYear: string; birthMonth: string; birthDay: string; heightCm: number; weightKg: number; bodyFat: string }, today = new Date()): BodyProblem[] {
  const out: BodyProblem[] = [];
  const y = Number(v.birthYear), mo = Number(v.birthMonth), d = Number(v.birthDay);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const validDate = v.birthYear.length === 4 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  if (!validDate) out.push("birth_date");
  else {
    const age = (today.getTime() - date.getTime()) / (365.25 * 86_400_000);
    if (age < 13 || age > 100) out.push("age");
  }
  if (!(v.heightCm >= 100 && v.heightCm <= 250)) out.push("height");
  if (!(v.weightKg >= 30 && v.weightKg <= 350)) out.push("weight");
  if (v.bodyFat.trim()) {
    const bf = parseNumber(v.bodyFat);
    if (!(bf >= 3 && bf <= 70)) out.push("body_fat");
  }
  return out;
}
