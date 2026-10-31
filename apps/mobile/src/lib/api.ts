import Constants from "expo-constants";
import { currentLang, t } from "../i18n";
import { secure } from "./storage";

// "/" means the website and the API share an origin (the server hosts the web build).
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Network failures and 5xx are retryable; validation and auth errors are not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}

let tokens: Tokens | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export async function loadTokens(): Promise<Tokens | null> {
  const raw = await secure.get("auth.tokens");
  tokens = raw ? (JSON.parse(raw) as Tokens) : null;
  return tokens;
}

export async function setTokens(t: Tokens | null): Promise<void> {
  tokens = t;
  if (t) await secure.set("auth.tokens", JSON.stringify({ accessToken: t.accessToken, accessTokenExpiresAt: t.accessTokenExpiresAt, refreshToken: t.refreshToken }));
  else await secure.remove("auth.tokens");
}

export function setSignedOutHandler(fn: () => void): void {
  onSignedOut = fn;
}

export function currentRefreshToken(): string | null {
  return tokens?.refreshToken ?? null;
}

async function refresh(): Promise<boolean> {
  if (!tokens) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: tokens!.refreshToken }) });
      if (!res.ok) {
        if (res.status === 401) {
          await setTokens(null);
          onSignedOut?.();
        }
        return false;
      }
      await setTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = opts.body || opts.form ? "POST" : "GET", auth = true } = opts;
  const qs = opts.query ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString() : "";
  // Refresh proactively when the access token is about to expire.
  if (auth && tokens && Date.parse(tokens.accessTokenExpiresAt) - Date.now() < 30_000) await refresh();
  const doFetch = async () => {
    // The coach replies in the app's language; other server text is English for now.
    const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": currentLang() };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    return fetch(`${API_URL}${path}${qs}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), signal: opts.signal });
  };
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && auth && tokens && (await refresh())) res = await doFetch();
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", t("You appear to be offline."));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}
