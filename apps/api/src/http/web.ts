import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Serves the exported web app (expo export -p web) from the same origin as
 * the API, so one address is both the website and the server. Unknown paths
 * outside /v1 get index.html and the app's router takes over.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export function registerWebApp(app: FastifyInstance, webDir: string): void {
  const root = path.resolve(webDir);
  const index = path.join(root, "index.html");

  app.get("/*", { config: { rateLimit: false } }, async (req, reply) => {
    const urlPath = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/\/+$/, "") || "/");
    if (urlPath === "/v1" || urlPath.startsWith("/v1/")) return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
    let file = path.join(root, urlPath);
    if (!file.startsWith(root + path.sep) && file !== root) return reply.code(404).send();
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = index;
    const ext = path.extname(file);
    // Expo's bundles carry a content hash in their name; the page itself must always be fresh.
    const immutable = file.includes(`${path.sep}_expo${path.sep}`) || file.includes(`${path.sep}assets${path.sep}`);
    reply
      .header("Content-Type", TYPES[ext] ?? "application/octet-stream")
      .header("Cache-Control", file === index ? "no-cache" : immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    return reply.send(createReadStream(file));
  });
}
