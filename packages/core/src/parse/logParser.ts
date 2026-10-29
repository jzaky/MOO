import { lbToKg, normalizeUnitToken, type MassUnit, type VolumeUnit } from "../units";

/**
 * Deterministic parser for short natural-language logging utterances
 * ("I ate three eggs and two slices of toast", "4 sets of bench at 80 kilos").
 *
 * It handles the common, unambiguous patterns offline and without an LLM. The
 * output is ALWAYS a draft for user confirmation; anything uncertain is
 * reported in `issues` rather than guessed. The AI layer is used as a fallback
 * for utterances this parser marks as `unrecognized`.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, half: 0.5, "a half": 0.5, quarter: 0.25, couple: 2, "a couple of": 2,
  dozen: 12, "a dozen": 12,
};

const COUNT_UNITS: Record<string, string> = {
  slice: "slice", slices: "slice", piece: "piece", pieces: "piece", bowl: "bowl", bowls: "bowl",
  scoop: "scoop", scoops: "scoop", serving: "serving", servings: "serving", handful: "handful", handfuls: "handful",
  can: "can", cans: "can", bottle: "bottle", bottles: "bottle", glass: "glass", glasses: "glass", plate: "plate", plates: "plate",
  bar: "bar", bars: "bar", packet: "packet", packets: "packet", pack: "packet", wrap: "wrap", wraps: "wrap", egg: "", eggs: "",
};

export type ParsedQuantityUnit = MassUnit | VolumeUnit | { count: string };

export interface ParsedFoodItem {
  text: string;
  quantity: number;
  /** Mass/volume unit, a count unit ("slice"), or count with empty unit ("3 eggs"). */
  unit: ParsedQuantityUnit;
  name: string;
  /** True when quantity was not stated and defaulted to 1. */
  quantityAssumed: boolean;
}

export interface ParsedExerciseEntry {
  text: string;
  exerciseName: string;
  sets: number;
  reps: number | null;
  weightKg: number | null;
  originalWeight: { value: number; unit: "kg" | "lb" } | null;
}

export type ParsedIntent =
  | { kind: "food"; items: ParsedFoodItem[]; issues: string[] }
  | { kind: "exercise"; entries: ParsedExerciseEntry[]; issues: string[] }
  | { kind: "body_weight"; weightKg: number; original: { value: number; unit: "kg" | "lb" }; issues: string[] }
  | { kind: "water"; ml: number; issues: string[] }
  | { kind: "unrecognized"; issues: string[] };

function parseNumberToken(tok: string): number | null {
  const t = tok.trim().toLowerCase();
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split("/").map(Number) as [number, number];
    return b ? a / b : null;
  }
  if (/^\d+\s+\d+\/\d+$/.test(t)) {
    const [w, frac] = t.split(/\s+/) as [string, string];
    const [a, b] = frac.split("/").map(Number) as [number, number];
    return b ? Number(w) + a / b : null;
  }
  return NUMBER_WORDS[t] ?? null;
}

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|half|a half|couple|a couple of|dozen|a dozen)`;
const WEIGHT_UNIT = String.raw`(kg|kgs|kilo|kilos|kilograms?|lb|lbs|pounds?)`;

function toKg(value: number, unitTok: string): { kg: number; unit: "kg" | "lb" } {
  const u = normalizeUnitToken(unitTok);
  return u === "lb" ? { kg: lbToKg(value), unit: "lb" } : { kg: value, unit: "kg" };
}

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(please\s+)?(log|add|record|track)\s+(that\s+)?/, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function parseBodyWeight(t: string): ParsedIntent | null {
  const re = new RegExp(String.raw`\b(?:i\s+)?(?:weighed|weigh|weight(?:\s+was|\s+is)?|body\s*weight(?:\s+was|\s+is)?|scale\s+(?:said|says|showed))\s*(?:in\s+at\s+)?(\d+(?:[.,]\d+)?)\s*${WEIGHT_UNIT}?`);
  const m = t.match(re);
  if (!m) return null;
  const value = Number(m[1]!.replace(",", "."));
  const issues: string[] = [];
  let unitTok = m[2];
  if (!unitTok) {
    issues.push("No unit given; assumed kilograms.");
    unitTok = "kg";
  }
  const { kg, unit } = toKg(value, unitTok);
  if (kg < 25 || kg > 350) issues.push("That body weight looks implausible; please double-check.");
  return { kind: "body_weight", weightKg: Math.round(kg * 100) / 100, original: { value, unit }, issues };
}

function parseWater(t: string): ParsedIntent | null {
  const m = t.match(new RegExp(String.raw`\b(?:drank|drink|had)?\s*${NUM}\s*(ml|millilitres?|milliliters?|l|litres?|liters?|glass(?:es)?|cups?|bottles?)\s+(?:of\s+)?water\b`));
  if (!m) return null;
  const q = parseNumberToken(m[1]!);
  if (q === null) return null;
  const u = m[2]!;
  const issues: string[] = [];
  let ml: number;
  if (/^glass/.test(u)) {
    ml = q * 250;
    issues.push("Assumed 250 ml per glass.");
  } else if (/^cup/.test(u)) {
    ml = q * 240;
  } else if (/^bottle/.test(u)) {
    ml = q * 500;
    issues.push("Assumed 500 ml per bottle.");
  } else if (/^(l|lit)/.test(u)) {
    ml = q * 1000;
  } else ml = q;
  return { kind: "water", ml, issues };
}

function parseExercise(t: string): ParsedIntent | null {
  if (!/\bsets?\b|\breps?\b|\d+\s*x\s*\d+/.test(t)) return null;
  const parts = t.split(/\s*(?:,|;|\bthen\b|\band then\b|\band\b(?=\s+(?:\d|a |an |one|two|three|four|five|six)))\s*/).filter(Boolean);
  const entries: ParsedExerciseEntry[] = [];
  const issues: string[] = [];
  const W = String.raw`(?:\s*(?:at|with|@)\s*(\d+(?:[.,]\d+)?)\s*${WEIGHT_UNIT}?)?`;
  const R = String.raw`(?:\s*(?:for|of|x)\s*(\d+)\s*(?:reps?)?)?`;
  for (const raw of parts) {
    const part = raw.replace(/^(?:i\s+)?(?:did|do|done|completed|finished|performed)\s+/, "").trim();
    // "4 sets of bench press at 80 kilos for 8 reps"
    let m = part.match(new RegExp(String.raw`^${NUM}\s+sets?\s+(?:of\s+)?(\d+\s+(?:reps?\s+)?(?:of\s+)?)?(.+?)${W}${R}$`));
    if (m) {
      const sets = parseNumberToken(m[1]!) ?? 1;
      const inlineReps = m[2] ? Number(m[2].match(/\d+/)![0]) : null;
      const name = m[3]!.trim();
      const weight = m[4] ? toKg(Number(m[4].replace(",", ".")), m[5] ?? "kg") : null;
      if (m[4] && !m[5]) issues.push(`No unit for ${name} load; assumed kilograms.`);
      const reps = m[6] ? Number(m[6]) : inlineReps;
      if (reps === null) issues.push(`Reps not stated for ${name}.`);
      entries.push({ text: raw, exerciseName: name, sets, reps, weightKg: weight ? Math.round(weight.kg * 100) / 100 : null, originalWeight: weight && m[4] ? { value: Number(m[4].replace(",", ".")), unit: weight.unit } : null });
      continue;
    }
    // "3x10 bench press at 80kg" / "bench press 3x10 at 80kg"
    m = part.match(new RegExp(String.raw`^(?:(\d+)\s*x\s*(\d+)\s+(.+?)|(.+?)\s+(\d+)\s*x\s*(\d+))${W}$`));
    if (m) {
      const sets = Number(m[1] ?? m[5]);
      const reps = Number(m[2] ?? m[6]);
      const name = (m[3] ?? m[4])!.trim();
      const weight = m[7] ? toKg(Number(m[7].replace(",", ".")), m[8] ?? "kg") : null;
      if (m[7] && !m[8]) issues.push(`No unit for ${name} load; assumed kilograms.`);
      entries.push({ text: raw, exerciseName: name, sets, reps, weightKg: weight ? Math.round(weight.kg * 100) / 100 : null, originalWeight: weight && m[7] ? { value: Number(m[7].replace(",", ".")), unit: weight.unit } : null });
      continue;
    }
    // "bench press 80 kg for 8 reps"
    m = part.match(new RegExp(String.raw`^(.+?)\s+(\d+(?:[.,]\d+)?)\s*${WEIGHT_UNIT}\s+(?:for\s+)?(\d+)\s*reps?$`));
    if (m) {
      const weight = toKg(Number(m[2]!.replace(",", ".")), m[3]!);
      entries.push({ text: raw, exerciseName: m[1]!.trim(), sets: 1, reps: Number(m[4]), weightKg: Math.round(weight.kg * 100) / 100, originalWeight: { value: Number(m[2]!.replace(",", ".")), unit: weight.unit } });
      continue;
    }
    issues.push(`Could not understand "${raw}".`);
  }
  if (!entries.length) return null;
  for (const e of entries) {
    if (e.sets > 20) issues.push(`${e.sets} sets of ${e.exerciseName} seems unusually high; please confirm.`);
    if (e.reps !== null && e.reps > 100) issues.push(`${e.reps} reps of ${e.exerciseName} seems unusually high; please confirm.`);
  }
  return { kind: "exercise", entries, issues };
}

function parseFoodItem(raw: string): { item: ParsedFoodItem | null; issue?: string } {
  let s = raw.trim().replace(/^(?:some|a bit of|a little)\s+/, "");
  if (!s) return { item: null };
  let quantity = 1;
  let quantityAssumed = true;
  let unit: ParsedQuantityUnit = { count: "" };

  // "200g", "200 g", "1.5 cups", "two slices"
  const m = s.match(new RegExp(String.raw`^${NUM}\s*(?:-|\s)?\s*([a-z_]+(?:\s+oz)?)?\s*(?:of\s+)?(.*)$`));
  if (m && m[1]) {
    const q = parseNumberToken(m[1]);
    if (q !== null) {
      quantity = q;
      quantityAssumed = false;
      const unitTok = m[2] ?? "";
      let rest = m[3] ?? "";
      const massVol = normalizeUnitToken(unitTok);
      if (massVol) unit = massVol;
      else if (unitTok in COUNT_UNITS) {
        unit = { count: COUNT_UNITS[unitTok]! };
        if (COUNT_UNITS[unitTok] === "") rest = `${unitTok} ${rest}`.trim();
      } else rest = `${unitTok} ${rest}`.trim();
      s = rest.replace(/^of\s+/, "");
    }
  }
  const name = s.replace(/\s+/g, " ").trim();
  if (!name) return { item: null, issue: `Missing food name in "${raw}".` };
  return { item: { text: raw.trim(), quantity, unit, name, quantityAssumed } };
}

function parseFood(t: string): ParsedIntent | null {
  const m = t.match(/^(?:i\s+)?(?:just\s+)?(?:ate|had|eaten|eat|have had|consumed|snacked on)\s+(.+)$/) ?? t.match(/^(.+?)\s+for\s+(?:breakfast|lunch|dinner|a snack|snack)$/);
  // Bare quantity-led utterances ("200 grams of chicken breast") after "log ..." was stripped.
  const bare = !m && new RegExp(String.raw`^${NUM}\s*(?:[a-z]+\s+)?(?:of\s+)?[a-z]`).test(t) ? t : null;
  const body = m ? m[1]! : bare;
  if (!body) return null;
  const parts = body
    .replace(/\s+for\s+(?:breakfast|lunch|dinner|a snack|snack)$/, "")
    .split(/\s*(?:,|\band\b|\bwith\b|\bplus\b|&)\s*/)
    .filter(Boolean);
  const items: ParsedFoodItem[] = [];
  const issues: string[] = [];
  for (const p of parts) {
    const { item, issue } = parseFoodItem(p);
    if (issue) issues.push(issue);
    if (item) {
      if (item.quantityAssumed) issues.push(`No amount given for ${item.name}; assumed 1 serving.`);
      items.push(item);
    }
  }
  if (!items.length) return null;
  return { kind: "food", items, issues };
}

export function parseLogUtterance(input: string): ParsedIntent {
  const t = clean(input);
  if (!t) return { kind: "unrecognized", issues: ["Nothing to parse."] };
  return parseBodyWeight(t) ?? parseWater(t) ?? parseExercise(t) ?? parseFood(t) ?? { kind: "unrecognized", issues: ["Could not recognise this as a food, workout, weight or water log."] };
}

export function mealFromUtterance(input: string): "breakfast" | "lunch" | "dinner" | "snacks" | null {
  const t = input.toLowerCase();
  if (/\bbreakfast\b/.test(t)) return "breakfast";
  if (/\blunch\b/.test(t)) return "lunch";
  if (/\b(dinner|supper)\b/.test(t)) return "dinner";
  if (/\bsnacks?\b/.test(t)) return "snacks";
  return null;
}

/**
 * Parse one recipe ingredient line ("2 cups rolled oats", "1/2 tsp salt",
 * "200g chicken thighs, diced"). Preparation notes after a comma are split off.
 */
export function parseIngredientLine(line: string): (ParsedFoodItem & { preparation: string | null }) | null {
  const cleaned = line
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/[▢•*·-]\s*/g, " ")
    .replace(/½/g, "1/2").replace(/¼/g, "1/4").replace(/¾/g, "3/4").replace(/⅓/g, "1/3").replace(/⅔/g, "2/3")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const [main, ...prep] = cleaned.split(",");
  const { item } = parseFoodItem(main!);
  if (!item) return null;
  return { ...item, text: line.trim(), preparation: prep.join(",").trim() || null };
}
