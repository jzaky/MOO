import type { Food } from "../../lib/types";
import { Badge } from "../../ui/primitives";

/** Short badge for a search row: pork/alcohol for users who avoid them, else "estimate" for standard recipes. */
export function dietRowBadge(f: Food, avoids: boolean) {
  const d = f.dietFlags;
  if (avoids && d) {
    if (d.pork === "contains") return <Badge label="pork" tone="danger" />;
    if (d.alcohol === "contains") return <Badge label="alcohol" tone="danger" />;
    if (d.pork === "may_contain" || d.alcohol === "may_contain") return <Badge label="check" tone="warning" />;
  }
  if (f.source === "standard_recipe") return <Badge label="estimate" tone="info" />;
  if (f.completeness < 1) return <Badge label="partial" tone="warning" />;
  return undefined;
}

/** Plain-language lines for the food page. */
export function dietLines(f: Food): string[] {
  const d = f.dietFlags;
  if (!d) return [];
  const out: string[] = [];
  if (d.pork === "contains") out.push(`Contains pork (${d.reasons.pork.join("; ")}).`);
  else if (d.pork === "may_contain") out.push(`May contain pork (${d.reasons.pork.join("; ")}). Check the pack.`);
  if (d.alcohol === "contains") out.push(`Contains alcohol (${d.reasons.alcohol.join("; ")}).`);
  if (!d.pork && !d.alcohol) out.push(d.ingredientsChecked ? "No pork or alcohol found in the name or ingredient list." : "No pork or alcohol in the name. There's no ingredient list to check.");
  if (d.halalLabel) out.push("The manufacturer labels this product halal.");
  return out;
}

export const DIET_DISCLAIMER = "Stoke reads names and ingredient lists. It can't certify halal: slaughter method, processing aids and cross-contact aren't in food data.";
