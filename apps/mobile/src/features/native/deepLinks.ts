/**
 * Deep links handled by the app (pure, no React Native imports so it is unit-testable):
 *
 *   stoke://log?text=<urlencoded>  → /food/voice?text=…  (prefilled and parsed automatically)
 *   stoke://log                    → /food/voice
 *   stoke://workout/start          → /workout/active when a workout is in progress, otherwise /train
 *   stoke://weigh-in               → /weigh-in
 *
 * Siri / App Shortcuts, home-screen widgets, the Live Activity and Android
 * launcher shortcuts all open the app through these URLs.
 */

export const APP_SCHEME = "stoke";

/** Longest text accepted from a link; longer input is cut, never rejected. */
export const MAX_LOG_TEXT = 500;

export function buildLogUrl(text: string): string {
  return `${APP_SCHEME}://log?text=${encodeURIComponent(text)}`;
}

export const WORKOUT_START_URL = `${APP_SCHEME}://workout/start`;
export const WEIGH_IN_URL = `${APP_SCHEME}://weigh-in`;
export const NUTRITION_URL = `${APP_SCHEME}://nutrition`;

function decodeComponent(raw: string): string {
  // `+` is a space in form-encoded queries; a literal plus arrives as %2B.
  const s = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Splits a query string (without the leading `?`) into decoded key/value pairs. First value wins. */
export function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeComponent(eq === -1 ? part : part.slice(0, eq));
    const value = decodeComponent(eq === -1 ? "" : part.slice(eq + 1));
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Normalises the `text` route param of the voice screen: trims, collapses
 * whitespace, caps the length. Returns null when there is nothing to parse.
 */
export function normalizeLogText(param: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LOG_TEXT).trim();
  return t ? t : null;
}

export interface ParsedLink {
  /** Path segments after the scheme, e.g. ["workout", "start"]. */
  segments: string[];
  query: Record<string, string>;
}

/**
 * Parses an incoming URL or path. Accepts `stoke://host/path?q`, `stoke:///path`,
 * `/path?q`, `path?q` and Expo dev-client style `exp+stoke://…` / `--/` prefixes.
 */
export function parseIncoming(input: string): ParsedLink {
  let s = input.trim();
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  const qIndex = s.indexOf("?");
  const query = qIndex === -1 ? {} : parseQuery(s.slice(qIndex + 1));
  let path = qIndex === -1 ? s : s.slice(0, qIndex);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  // Expo Go / dev client URLs carry the app path after "--/".
  const dashes = path.indexOf("--/");
  if (dashes !== -1) path = path.slice(dashes + 3);
  const segments = path.split("/").filter(Boolean).map(decodeComponent);
  return { segments, query };
}

/**
 * Maps an incoming URL to an app route, or returns null when the URL is not one
 * of ours (the caller then lets Expo Router resolve it unchanged).
 */
export function resolveDeepLink(input: string, ctx: { hasActiveWorkout: boolean }): string | null {
  const { segments, query } = parseIncoming(input);
  const [first, second] = segments;
  if (first === "log" && segments.length === 1) {
    const text = normalizeLogText(query.text);
    return text ? `/food/voice?text=${encodeURIComponent(text)}` : "/food/voice";
  }
  if (first === "workout" && second === "start" && segments.length === 2) {
    return ctx.hasActiveWorkout ? "/workout/active" : "/train";
  }
  if (first === "weigh-in" && segments.length === 1) return "/weigh-in";
  return null;
}
