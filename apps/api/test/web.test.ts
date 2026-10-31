import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  const web = mkdtempSync(path.join(tmpdir(), "stoke-web-"));
  writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Stoke</title>");
  mkdirSync(path.join(web, "_expo", "static", "js"), { recursive: true });
  writeFileSync(path.join(web, "_expo", "static", "js", "entry-abc123.js"), "console.log(1)");
  t = await makeTestApp({}, { WEB_DIR: web });
});
afterAll(async () => t.close());

describe("website served with the API", () => {
  it("serves the app, its hashed assets, and the page for app routes", async () => {
    const home = await t.app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.headers["cache-control"]).toBe("no-cache");
    const js = await t.app.inject({ method: "GET", url: "/_expo/static/js/entry-abc123.js" });
    expect(js.body).toBe("console.log(1)");
    expect(js.headers["cache-control"]).toContain("immutable");
    const deep = await t.app.inject({ method: "GET", url: "/workout/active?templateId=x" });
    expect(deep.body).toContain("<title>Stoke</title>");
  });

  it("keeps the API's own answers and never leaves the web folder", async () => {
    expect((await t.app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    const api = await t.app.inject({ method: "GET", url: "/v1/does-not-exist" });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("not_found");
    expect((await t.app.inject({ method: "GET", url: "/v1/profile" })).statusCode).toBe(401);
    const escape = await t.app.inject({ method: "GET", url: "/..%2F..%2F..%2Fetc%2Fpasswd" });
    expect(escape.body).not.toContain("root:");
  });
});
