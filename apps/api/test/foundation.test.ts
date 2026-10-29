import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { goals, nutritionTargets, profiles } from "../src/db/schema";
import { makeTestApp, onboard, pgError, registerUser, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => {
  await t.close();
});

describe("authentication", () => {
  it("registers, logs in, and rejects bad credentials without revealing which part was wrong", async () => {
    const u = await registerUser(t.app);
    const ok = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: u.email.toUpperCase(), password: "correct horse battery" } });
    expect(ok.statusCode).toBe(200);
    const bad = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: u.email, password: "wrong password!!" } });
    const missing = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "nobody@example.com", password: "wrong password!!" } });
    expect(bad.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(missing.json().error.message);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const u = await registerUser(t.app);
    const dup = await t.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: u.email, password: "another long password" } });
    expect(dup.statusCode).toBe(409);
    const weak = await t.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "weak@example.com", password: "short" } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("validation_error");
  });

  it("requires a valid access token", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/profile" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/v1/profile", headers: { authorization: "Bearer not-a-jwt" } })).statusCode).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const u = await registerUser(t.app);
    const r1 = await t.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: u.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refreshToken as string;
    expect(next).not.toBe(u.refreshToken);
    // Replaying the old token = theft signal → whole family revoked.
    const replay = await t.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: u.refreshToken } });
    expect(replay.statusCode).toBe(401);
    const afterRevoke = await t.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: next } });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("logs out by revoking the refresh token", async () => {
    const u = await registerUser(t.app);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: u.refreshToken } })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: u.refreshToken } })).statusCode).toBe(401);
  });
});

describe("onboarding and targets", () => {
  it("previews a plan with estimated targets and a split", async () => {
    const u = await registerUser(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/onboarding/plan",
      headers: u.headers,
      payload: { sex: "female", birthDate: "1995-01-01", heightCm: 165, weightKg: 70, activityLevel: "light", goals: [{ kind: "lose_fat", priority: 1 }, { kind: "strength", priority: 2 }], training: { preferredDays: [1, 2, 4, 5], experience: "intermediate" } },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.targets.basis).toBe("estimated");
    expect(plan.targets.energyKcal).toBeLessThan(plan.targets.estimatedTdeeKcal);
    expect(plan.training.split).toBe("upper_lower");
    expect(plan.disclaimer).toMatch(/estimates/);
  });

  it("completes onboarding, storing profile, goals, targets and first weigh-in", async () => {
    const u = await registerUser(t.app);
    const out = await onboard(t.app, u.headers);
    expect(out.profile.onboardingCompletedAt).toBeTruthy();
    expect(out.targets.basis).toBe("estimated");
    const targets = await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers });
    expect(targets.json().current.energyKcal).toBe(out.targets.energyKcal);
  });

  it("records user edits as manual targets and keeps history", async () => {
    const u = await registerUser(t.app);
    await onboard(t.app, u.headers, { targetOverrides: { proteinG: 190 } });
    const first = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json();
    expect(first.current).toMatchObject({ basis: "manual", proteinG: 190 });
    const edit = await t.app.inject({ method: "POST", url: "/v1/nutrition/targets", headers: u.headers, payload: { energyKcal: 2300, proteinG: 180, carbsG: 230, fatG: 75, fiberG: 30 } });
    expect(edit.statusCode).toBe(201);
    const after = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json();
    expect(after.current.energyKcal).toBe(2300);
    expect(after.history).toHaveLength(2);
  });

  it("validates profile updates", async () => {
    const u = await registerUser(t.app);
    const bad = await t.app.inject({ method: "PUT", url: "/v1/profile", headers: u.headers, payload: { timeZone: "Mars/Olympus" } });
    expect(bad.statusCode).toBe(400);
    const ok = await t.app.inject({ method: "PUT", url: "/v1/profile", headers: u.headers, payload: { unitSystem: "imperial", displayName: "J" } });
    expect(ok.json()).toMatchObject({ unitSystem: "imperial", displayName: "J" });
  });
});

describe("data isolation (Row-Level Security)", () => {
  it("the runtime role cannot read another user's rows even with a crafted query", async () => {
    const a = await registerUser(t.app, "alice");
    const b = await registerUser(t.app, "bob");
    await onboard(t.app, a.headers);
    await onboard(t.app, b.headers);
    // As Bob, select every row with no WHERE clause.
    const seen = await t.db.asUser(b.userId, async (tx) => ({
      profiles: await tx.select().from(profiles),
      goals: await tx.select().from(goals),
      targets: await tx.select().from(nutritionTargets),
    }));
    expect(seen.profiles.map((p) => p.userId)).toEqual([b.userId]);
    expect(new Set(seen.goals.map((g) => g.userId))).toEqual(new Set([b.userId]));
    expect(new Set(seen.targets.map((g) => g.userId))).toEqual(new Set([b.userId]));
  });

  it("the runtime role cannot write rows for another user", async () => {
    const a = await registerUser(t.app, "alice");
    const b = await registerUser(t.app, "bob");
    expect(await pgError(t.db.asUser(b.userId, (tx) => tx.insert(goals).values({ userId: a.userId, kind: "maintain", priority: 1 })))).toMatch(/row-level security/);
  });

  it("without a user context the runtime role sees nothing and cannot read auth tables", async () => {
    const rows = await t.db.app.select().from(profiles);
    expect(rows).toEqual([]);
    expect(await pgError(t.db.app.execute(sql`select * from users`))).toMatch(/permission denied/);
    expect(await pgError(t.db.app.execute(sql`select * from refresh_tokens`))).toMatch(/permission denied/);
  });
});

describe("account deletion", () => {
  it("requires the password, then removes all user data", async () => {
    const u = await registerUser(t.app);
    await onboard(t.app, u.headers);
    const wrong = await t.app.inject({ method: "DELETE", url: "/v1/me", headers: u.headers, payload: { password: "nope nope nope", confirm: "DELETE" } });
    expect(wrong.statusCode).toBe(401);
    const del = await t.app.inject({ method: "DELETE", url: "/v1/me", headers: u.headers, payload: { password: "correct horse battery", confirm: "DELETE" } });
    expect(del.statusCode).toBe(204);
    const left = await t.db.system.select().from(profiles).where(sql`${profiles.userId} = ${u.userId}`);
    expect(left).toEqual([]);
    const login = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: u.email, password: "correct horse battery" } });
    expect(login.statusCode).toBe(401);
  });
});

describe("web client access (CORS)", () => {
  it("allows the write methods the offline outbox uses from an allowed origin", async () => {
    const res = await t.app.inject({ method: "OPTIONS", url: "/v1/food-logs/00000000-0000-4000-8000-000000000000", headers: { origin: "http://localhost:8081", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" } });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    expect(String(res.headers["access-control-allow-methods"])).toMatch(/PUT/);
    expect(String(res.headers["access-control-allow-methods"])).toMatch(/DELETE/);
  });
  it("does not grant other origins", async () => {
    const res = await t.app.inject({ method: "OPTIONS", url: "/v1/profile", headers: { origin: "https://evil.example", "access-control-request-method": "PUT" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
