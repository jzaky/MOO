/**
 * Food search ranking. The database returns candidates that share words (or
 * trigrams) with the query; this decides their order. It is pure so ranking
 * quality can be tested without a database.
 *
 * Most generic foods use USDA naming: comma-separated segments, the food
 * first and descriptors after ("Bananas, raw"), sometimes behind a category
 * ("Fish, salmon, Atlantic, raw"). The strongest signal is therefore whether
 * the food's head segment is what the user asked for: "banana" should find
 * "Bananas, raw" before "Pepper, banana, raw".
 */

export interface SearchCandidate {
  name: string;
  brand: string | null;
  /** The user's own food or recipe. */
  isPrivate: boolean;
  /** How many times this user logged the food. */
  uses: number;
  /** Fraction of key nutrients present (0–1); tie-breaker only. */
  completeness: number;
  /** pg_trgm word similarity between query and name (0–1); rescues typos. */
  similarity: number;
}

/** Leading segments that name a category rather than the food itself. */
const CATEGORY_HEADS = new Set(["fish", "cereals", "cereal", "nuts", "nut", "beef", "pork", "lamb", "veal", "cheese", "spices", "spice", "seeds", "seed", "beverages", "beverage", "crustaceans", "mollusks", "game meat"]);
/** Preparation words that describe the plain form of a food; never penalised as "extra". */
export const SEARCH_DESCRIPTORS: ReadonlySet<string> = new Set(["raw", "whole", "plain", "fresh", "cooked", "regular", "fluid", "boiled", "drained", "roasted", "baked", "grilled", "unsalted", "all", "commercial", "varieties", "mature", "meat", "only", "flesh"]);
/** Forms people rarely mean unless they say so. */
const PROCESSED = ["breaded", "battered", "nugget", "tender", "patty", "patties", "roll", "luncheon", "deli", "microwaved", "frozen", "candied", "souffle", "flour", "pancake", "chip", "cracker", "cake", "cookie", "snack", "ready-to-eat", "fast food", "restaurant", "babyfood", "baby food", "infant", "formula", "dry mix", "powder", "powdered", "dehydrated", "dried", "imitation", "substitute", "alaska native", "for reference only", "leaves", "glutinous", "candies", "candy", "alcoholic", "meatless", "sheep", "goat", "buffalo", "human", "producer"];
const LIGHTLY_PROCESSED = ["fried", "canned", "smoked", "stewed", "pickled", "salted", "kippered", "sweetened", "sliced", "with salt", "instant"];
/** Fortification and labelling boilerplate; not counted as extra words. */
const NOISE = new Set(["added", "vitamin", "fortified", "enriched", "unenriched", "prepared", "commercially", "unprepared", "style", "type", "usda"]);
const STOP = new Set(["and", "or", "with", "without", "of", "the", "a", "in", "not", "includes", "to", "as"]);

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(o|s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length >= 1 && !STOP.has(w));
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/**
 * Does a query word refer to this name word? Exact stem, a one-letter typo,
 * or (unless `strict`) a prefix still being typed: "chick" → "chicken".
 */
export function wordMatches(q: string, w: string, strict = false): boolean {
  const qs = stem(q), ws = stem(w);
  if (qs === ws || q === w) return true;
  if (!strict && q.length >= 3 && w.startsWith(q)) return true;
  if (qs.length >= 5 && editDistanceAtMost(qs, ws, qs.length >= 8 ? 2 : 1)) return true;
  return false;
}

/** The segment that names the food: the first, unless it is only a category. */
function headSegment(segments: string[]): string {
  const first = segments[0]?.trim().toLowerCase() ?? "";
  return CATEGORY_HEADS.has(first) && segments[1] ? segments[1] : first;
}

// Whole words only (plural allowed), so "tender" does not match "tenderloin".
const hasPhrase = (text: string, list: string[]) => list.some((p) => new RegExp(`\\b${p.replace(/-/g, "[- ]?")}(s|es)?\\b`).test(text));

export function rankScore(query: string, c: SearchCandidate): number {
  const q = [...new Set(words(query))];
  if (!q.length) return 0;
  const lowerName = c.name.toLowerCase();
  const segments = c.name.split(",");
  const nameWords = words(`${c.name} ${c.brand ?? ""}`);
  // Descriptive words ("raw", "cooked") refine; they must not outweigh the food itself.
  const key = q.filter((t) => !SEARCH_DESCRIPTORS.has(t));
  const descriptive = q.filter((t) => SEARCH_DESCRIPTORS.has(t));
  const found = (ts: string[]) => ts.filter((t) => nameWords.some((w) => wordMatches(t, w))).length;
  const covered = key.length ? found(key) / key.length + (descriptive.length ? (0.1 * found(descriptive)) / descriptive.length : 0) : found(q) / q.length;

  const head = words(headSegment(segments)).filter((w) => !/\d/.test(w));
  // Full credit needs exact words, so "milk" names "Milk, whole" before "Fish,
  // milkfish"; a prefix still being typed ("banan") earns partial credit.
  const exact = head.filter((w) => q.some((t) => wordMatches(t, w, true))).length;
  const loose = head.filter((w) => q.some((t) => wordMatches(t, w))).length;
  const headScore = head.length && exact === head.length ? 0.5 : loose > 0 ? 0.2 : 0;

  const category = CATEGORY_HEADS.has(segments[0]?.trim().toLowerCase() ?? "") ? new Set(words(segments[0]!)) : new Set<string>();
  const extras = words(c.name).filter((w) => w.length > 1 && !/\d/.test(w) && !SEARCH_DESCRIPTORS.has(w) && !NOISE.has(w) && !category.has(w) && !q.some((t) => wordMatches(t, w))).length;

  const qText = q.join(" ");
  const processed = hasPhrase(lowerName, PROCESSED) && !hasPhrase(qText, PROCESSED) ? 0.3 : 0;
  const lightly = hasPhrase(lowerName, LIGHTLY_PROCESSED) && !hasPhrase(qText, LIGHTLY_PROCESSED) ? 0.1 : 0;
  // Restaurant-style ALL-CAPS names from bulk imports are rarely the generic food.
  const shouting = /[A-Z]{4,}/.test(c.name.replace(/\([^)]*\)/g, "")) && !c.isPrivate ? 0.2 : 0;

  return (
    covered +
    headScore +
    0.3 * c.similarity -
    Math.min(0.4, extras * 0.04) -
    processed -
    lightly -
    shouting -
    (covered === 0 ? 0.5 : 0) +
    (c.isPrivate ? 0.15 : 0) +
    Math.min(0.3, Math.log(1 + c.uses) * 0.1)
  );
}

/** Order candidates best-first. Stable for equal scores (completeness, then shorter name). */
export function rankFoods<T extends SearchCandidate>(query: string, candidates: T[]): T[] {
  return candidates
    .map((c) => ({ c, s: rankScore(query, c) }))
    .sort((a, b) => b.s - a.s || b.c.completeness - a.c.completeness || a.c.name.length - b.c.name.length)
    .map((x) => x.c);
}
