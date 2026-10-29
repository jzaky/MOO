import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { badRequest } from "../http/errors";

/**
 * Fetch a user-supplied URL (recipe import) with SSRF protections: http(s)
 * only, no credentials in the URL, public IP addresses only (checked after DNS
 * resolution and on every redirect), a timeout and a response size cap.
 */

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw badRequest("Only http(s) URLs are supported");
  if (url.username || url.password) throw badRequest("URLs with credentials are not supported");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw badRequest("Could not resolve that address");
  if (addrs.some(isPrivateIp)) throw badRequest("That address is not allowed");
  return url;
}

export async function safeFetchText(raw: string, opts: { maxBytes?: number; timeoutMs?: number; userAgent: string; fetchImpl?: typeof fetch }): Promise<{ url: string; text: string; contentType: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let current = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetchImpl(current, {
      redirect: "manual",
      headers: { "User-Agent": opts.userAgent, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = (await assertPublicUrl(new URL(res.headers.get("location")!, current).toString())).toString();
      continue;
    }
    if (!res.ok) throw badRequest(`The page returned status ${res.status}`);
    const max = opts.maxBytes ?? 3_000_000;
    const reader = res.body?.getReader();
    if (!reader) return { url: current, text: "", contentType: res.headers.get("content-type") ?? "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw badRequest("The page is too large to import");
      }
      chunks.push(value);
    }
    return { url: current, text: Buffer.concat(chunks).toString("utf8"), contentType: res.headers.get("content-type") ?? "" };
  }
  throw badRequest("Too many redirects");
}
