/** Small, dependency-free statistics helpers. */

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stdDev(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

export function linearRegression(points: readonly { x: number; y: number }[]): LinearFit | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (const { x, y } of points) ssRes += (y - (slope * x + intercept)) ** 2;
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, n };
}

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs)!, my = mean(ys)!;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Two-sided p-value for Pearson r via the t distribution (n-2 df). */
export function pearsonPValue(r: number, n: number): number {
  if (n < 3) return 1;
  if (Math.abs(r) >= 1) return 0;
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - studentTCdf(t, n - 2));
}

/** CDF of Student's t via the regularized incomplete beta function. */
export function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

function logGamma(z: number): number {
  // Lanczos approximation (g=7, n=9).
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < 9; i++) x += c[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lbeta) * betaContinuedFraction(x, a, b)) / a;
  return 1 - (Math.exp(lbeta) * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIter = 200, eps = 3e-14, fpmin = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

export type CorrelationStrength = "insufficient_data" | "none" | "weak" | "moderate" | "strong";

export interface CorrelationResult {
  r: number | null;
  n: number;
  pValue: number | null;
  strength: CorrelationStrength;
  /** Always present so no consumer can forget the caveat. */
  caveat: string;
}

/**
 * Correlation with an explicit evidence label. Never implies causation; the
 * `caveat` field is meant to be displayed alongside any result.
 */
export function describeCorrelation(xs: readonly number[], ys: readonly number[], minN = 14): CorrelationResult {
  const n = Math.min(xs.length, ys.length);
  const caveat = "Correlation only: this does not show that one causes the other.";
  if (n < minN) return { r: null, n, pValue: null, strength: "insufficient_data", caveat };
  const r = pearson(xs.slice(0, n), ys.slice(0, n));
  if (r === null) return { r: null, n, pValue: null, strength: "insufficient_data", caveat };
  const p = pearsonPValue(r, n);
  const a = Math.abs(r);
  let strength: CorrelationStrength;
  if (p > 0.05 || a < 0.2) strength = "none";
  else if (a < 0.4) strength = "weak";
  else if (a < 0.6) strength = "moderate";
  else strength = "strong";
  return { r, n, pValue: p, strength, caveat };
}
