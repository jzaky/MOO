/**
 * Equipment-aware load rounding. A recommendation of "+2.5 %" is useless if the
 * gym's dumbbells jump from 30 to 32.5 kg.
 */

export type LoadProfile =
  | { kind: "barbell"; barKg: number; platePairsKg: readonly number[] }
  | { kind: "fixed_steps"; availableKg: readonly number[] }
  | { kind: "increment"; stepKg: number; minKg?: number }
  | { kind: "bodyweight" };

export const DEFAULT_PROFILES = {
  barbell: { kind: "barbell", barKg: 20, platePairsKg: [25, 20, 15, 10, 5, 2.5, 1.25] },
  dumbbell: {
    kind: "fixed_steps",
    availableKg: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 12.5, 14, 15, 16, 17.5, 18, 20, 22, 22.5, 24, 25, 26, 27.5, 28, 30, 32, 32.5, 34, 35, 36, 37.5, 38, 40, 42, 42.5, 44, 45, 46, 47.5, 48, 50],
  },
  machine: { kind: "increment", stepKg: 5, minKg: 5 },
  cable: { kind: "increment", stepKg: 2.5, minKg: 2.5 },
  bodyweight: { kind: "bodyweight" },
} as const satisfies Record<string, LoadProfile>;

/** All achievable loads for a profile up to `maxKg`, ascending. */
export function achievableLoads(profile: LoadProfile, maxKg = 400): number[] {
  switch (profile.kind) {
    case "bodyweight":
      return [0];
    case "fixed_steps":
      return [...new Set(profile.availableKg)].filter((x) => x <= maxKg).sort((a, b) => a - b);
    case "increment": {
      const out: number[] = [];
      for (let x = profile.minKg ?? profile.stepKg; x <= maxKg + 1e-9; x += profile.stepKg) out.push(Math.round(x * 1000) / 1000);
      return out;
    }
    case "barbell": {
      // Smallest increment = 2 × smallest plate.
      const smallest = Math.min(...profile.platePairsKg);
      const out: number[] = [];
      for (let x = profile.barKg; x <= maxKg + 1e-9; x += 2 * smallest) out.push(Math.round(x * 1000) / 1000);
      return out;
    }
  }
}

/** Smallest achievable load strictly greater than `currentKg`. */
export function nextLoadUp(profile: LoadProfile, currentKg: number): number | null {
  if (profile.kind === "bodyweight") return null;
  const loads = achievableLoads(profile, Math.max(currentKg * 2, currentKg + 50));
  return loads.find((x) => x > currentKg + 1e-9) ?? null;
}

/** Largest achievable load strictly less than `currentKg`. */
export function nextLoadDown(profile: LoadProfile, currentKg: number): number | null {
  if (profile.kind === "bodyweight") return null;
  const loads = achievableLoads(profile, currentKg);
  const below = loads.filter((x) => x < currentKg - 1e-9);
  return below.length ? below[below.length - 1]! : null;
}

/** Round a target load to the nearest achievable load (ties round down). */
export function roundToAchievable(profile: LoadProfile, targetKg: number): number {
  if (profile.kind === "bodyweight") return 0;
  const loads = achievableLoads(profile, targetKg + 50);
  let best = loads[0] ?? targetKg;
  for (const l of loads) if (Math.abs(l - targetKg) < Math.abs(best - targetKg) - 1e-9) best = l;
  return best;
}

/** Plates per side for a barbell load (greedy), or null if not achievable. */
export function platesPerSide(profile: Extract<LoadProfile, { kind: "barbell" }>, totalKg: number): number[] | null {
  let perSide = (totalKg - profile.barKg) / 2;
  if (perSide < -1e-9) return null;
  const plates = [...profile.platePairsKg].sort((a, b) => b - a);
  const out: number[] = [];
  for (const p of plates) {
    while (perSide >= p - 1e-9) {
      out.push(p);
      perSide -= p;
    }
  }
  return Math.abs(perSide) < 1e-6 ? out : null;
}
