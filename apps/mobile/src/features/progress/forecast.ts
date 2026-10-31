/**
 * When the trend reaches the goal at the current pace, with a range for the pace running
 * 25% slower or faster. Null when the pace is too uncertain, flat or heading away from the goal,
 * or the date is over two years out.
 */
export function goalForecast(args: { trendKg: number | null; goalKg: number | null; kgPerWeek: number | null; sufficiency: "insufficient" | "limited" | "good"; today: string }): { day: string; earliest: string; latest: string; weeks: number } | null {
  const { trendKg, goalKg, kgPerWeek, sufficiency, today } = args;
  if (trendKg == null || goalKg == null || kgPerWeek == null || sufficiency === "insufficient") return null;
  const remaining = goalKg - trendKg;
  if (Math.abs(remaining) < 0.1 || Math.abs(kgPerWeek) < 0.02 || Math.sign(remaining) !== Math.sign(kgPerWeek)) return null;
  const weeks = remaining / kgPerWeek;
  if (weeks > 104) return null;
  const at = (w: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.round(w * 7));
    return d.toISOString().slice(0, 10);
  };
  return { day: at(weeks), earliest: at(weeks / 1.25), latest: at(weeks / 0.75), weeks };
}
