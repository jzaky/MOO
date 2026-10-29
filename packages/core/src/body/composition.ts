import type { Sex } from "../nutrition/targets";

/**
 * Body-fat percentage from circumferences: the US Navy method (Hodgdon &
 * Beckett, 1984), metric form. It is an estimate: against lab methods its
 * typical error is roughly ±3–4 percentage points, and it is least reliable
 * at the extremes. Returns null when inputs are missing or implausible
 * rather than guessing.
 */
export interface NavyInput {
  sex: Sex;
  heightCm: number;
  waistCm: number;
  neckCm: number;
  /** Required for women. */
  hipCm?: number | null;
}

export interface BodyFatEstimate {
  percent: number;
  method: "us_navy";
  typicalErrorPct: number;
}

export function navyBodyFat(i: NavyInput): BodyFatEstimate | null {
  const { heightCm: h, waistCm: w, neckCm: n } = i;
  if (!(h >= 120 && h <= 230) || !(w > 40 && w < 250) || !(n > 20 && n < 70)) return null;
  let pct: number;
  if (i.sex === "male") {
    if (w - n <= 0) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
  } else {
    const hip = i.hipCm;
    if (!hip || !(hip > 50 && hip < 250) || w + hip - n <= 0) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(w + hip - n) + 0.221 * Math.log10(h)) - 450;
  }
  if (!Number.isFinite(pct) || pct < 2 || pct > 65) return null;
  return { percent: Math.round(pct * 10) / 10, method: "us_navy", typicalErrorPct: 3.5 };
}
