/**
 * Pork and alcohol flags from what the data actually says: the food's name,
 * its ingredient list (when the source has one), manufacturer labels and the
 * alcohol nutrient. This is a reading aid, not a halal certification:
 * slaughter method, processing aids and cross-contact are not in food data.
 */

export type FlagLevel = "contains" | "may_contain";

export interface DietFlags {
  pork: FlagLevel | null;
  alcohol: FlagLevel | null;
  /** The manufacturer labels the product halal (Open Food Facts label tag). Their claim, not ours. */
  halalLabel: boolean;
  /** Why each flag was raised, e.g. "ingredients: bacon". */
  reasons: { pork: string[]; alcohol: string[] };
  /** Whether an ingredient list was available. Without one, only the name was checked. */
  ingredientsChecked: boolean;
}

export interface DietFlagInput {
  name: string;
  ingredientsText?: string | null;
  labelsTags?: readonly string[] | null;
  alcoholG?: number | null;
}

// Plain-word matches. A preceding "beef", "turkey", "chicken" or "veal" makes ham/bacon/sausage-type words not pork.
const PORK = /\b(pork|bacon|hams?|prosciutto|pancetta|lard|chorizo|guanciale|jam[oó]n|speck|mortadella|porchetta|pig|pigs|swine|boar|crackling|chicharr[oó]n(?:es)?)\b/i;
const PORK_MAYBE = /\b(pepperoni|salami|sausages?|gelatine?|e441|frankfurters?|hot ?dogs?)\b/i;
const NOT_PORK_QUALIFIER = /\b(beef|turkey|chicken|veal|lamb|fish|bovine|halal|vegan|vegetarian|plant[- ]based|soy|meat[- ]free)\s+$/i;
// Databases often put the qualifier after the word: "Bacon, turkey" or "Sausage, chicken".
const NOT_PORK_AFTER = /^\s*(?:,|\(|-)?\s*(beef|turkey|chicken|veal|lamb|fish|halal|vegan|vegetarian|meatless|imitation|plant[- ]based|soy|meat[- ]free)\b/i;
const ALCOHOL = /\b(wine|beer|ale|lager|stout|rum|vodka|whiske?y|gin|brandy|cognac|liqueur|sake|mirin|sherry|champagne|bourbon|tequila|vermouth|cider|alcohol|ethanol|kirsch|amaretto|marsala|prosecco|liquor)\b/i;
const NOT_ALCOHOL_AFTER = /^\s*(vinegar|-?free)\b/i;
const NOT_ALCOHOL_BEFORE = /\b(sugar|ginger|root|non[- ]?alcoholic|alcohol[- ]free|de[- ]?alcoholi[sz]ed|0(?:[.,]0)?\s?%|no|zero)\s*$/i;

function findAll(re: RegExp, text: string): { word: string; before: string; after: string }[] {
  const g = new RegExp(re.source, "gi");
  const out: { word: string; before: string; after: string }[] = [];
  for (const m of text.matchAll(g)) out.push({ word: m[0], before: text.slice(Math.max(0, m.index - 30), m.index), after: text.slice(m.index + m[0].length, m.index + m[0].length + 20) });
  return out;
}

function scan(text: string, where: string, reasons: DietFlags["reasons"]): { pork: FlagLevel | null; alcohol: FlagLevel | null } {
  let pork: FlagLevel | null = null;
  let alcohol: FlagLevel | null = null;
  for (const m of findAll(PORK, text)) {
    if (NOT_PORK_QUALIFIER.test(m.before) || NOT_PORK_AFTER.test(m.after)) continue;
    pork = "contains";
    reasons.pork.push(`${where}: ${m.word.toLowerCase()}`);
    break;
  }
  if (!pork) {
    for (const m of findAll(PORK_MAYBE, text)) {
      if (NOT_PORK_QUALIFIER.test(m.before) || NOT_PORK_AFTER.test(m.after)) continue;
      pork = "may_contain";
      reasons.pork.push(`${where}: ${m.word.toLowerCase()} (source animal not stated)`);
      break;
    }
  }
  for (const m of findAll(ALCOHOL, text)) {
    if (NOT_ALCOHOL_AFTER.test(m.after) || NOT_ALCOHOL_BEFORE.test(m.before)) continue;
    alcohol = "contains";
    reasons.alcohol.push(`${where}: ${m.word.toLowerCase()}`);
    break;
  }
  return { pork, alcohol };
}

const worse = (a: FlagLevel | null, b: FlagLevel | null): FlagLevel | null => (a === "contains" || b === "contains" ? "contains" : a ?? b);

export function dietFlags(input: DietFlagInput): DietFlags {
  const reasons: DietFlags["reasons"] = { pork: [], alcohol: [] };
  const byName = scan(input.name, "name", reasons);
  const ingredients = input.ingredientsText?.trim() || null;
  const byIngredients = ingredients ? scan(ingredients, "ingredients", reasons) : { pork: null, alcohol: null };
  let alcohol = worse(byName.alcohol, byIngredients.alcohol);
  if (typeof input.alcoholG === "number" && input.alcoholG > 0.5) {
    alcohol = "contains";
    reasons.alcohol.push(`nutrients: ${input.alcoholG} g alcohol per 100`);
  }
  const labels = (input.labelsTags ?? []).map((t) => t.toLowerCase());
  return {
    pork: worse(byName.pork, byIngredients.pork),
    alcohol,
    halalLabel: labels.some((t) => /(^|:)halal$/.test(t)),
    reasons,
    ingredientsChecked: !!ingredients,
  };
}
