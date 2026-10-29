import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateProgram, suggestSplit, type CatalogueExercise } from "@stoke/core";
import { EXERCISES } from "../src/db/seed/exercises";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => t.close());

async function user() {
  const u = await registerUser(t.app);
  await onboard(t.app, u.headers);
  return u;
}

async function exerciseId(headers: Record<string, string>, q: string): Promise<string> {
  const r = (await t.app.inject({ method: "GET", url: `/v1/exercises?q=${encodeURIComponent(q)}`, headers })).json();
  return r.items[0].id;
}

function workout(day: string, exId: string, sets: [number, number][], status: "active" | "completed" = "completed", overrides: Record<string, unknown> = {}) {
  const seId = randomUUID();
  return {
    name: "Upper A",
    day,
    startedAt: `${day}T16:00:00Z`,
    endedAt: status === "completed" ? `${day}T17:00:00Z` : null,
    pausedSec: 0,
    status,
    clientUpdatedAt: `${day}T17:00:00Z`,
    exercises: [
      {
        id: seId,
        exerciseId: exId,
        position: 0,
        prescription: { scheme: "double_progression", sets: 3, repRange: { min: 8, max: 12 }, targetRir: 2, restSec: 120, loadProfile: "dumbbell" },
        sets: sets.map(([w, r], i) => ({ id: randomUUID(), position: i, kind: "working", weightKg: w, reps: r, completed: true, completedAt: `${day}T16:${10 + i}:00Z` })),
      },
    ],
    ...overrides,
  };
}

describe("exercise catalogue", () => {
  it("has consistent seed data (unique slugs, valid alternatives)", () => {
    const slugs = EXERCISES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of EXERCISES) for (const a of e.alternatives ?? []) expect(slugs).toContain(a);
    expect(EXERCISES.length).toBeGreaterThan(80);
  });

  it("searches by name and alias and resolves alternatives", async () => {
    const u = await user();
    const r = (await t.app.inject({ method: "GET", url: "/v1/exercises?q=rdl", headers: u.headers })).json();
    expect(r.items[0].slug).toBe("romanian-deadlift");
    const d = (await t.app.inject({ method: "GET", url: `/v1/exercises/${r.items[0].id}`, headers: u.headers })).json();
    expect(d.alternativeExercises.map((x: { slug: string }) => x.slug)).toContain("dumbbell-romanian-deadlift");
    const legs = (await t.app.inject({ method: "GET", url: "/v1/exercises?muscle=hamstrings", headers: u.headers })).json();
    expect(legs.items.length).toBeGreaterThan(3);
  });
});

describe("program generation", () => {
  const catalogue: CatalogueExercise[] = EXERCISES.map((e, i) => ({ id: String(i), slug: e.slug, name: e.name, pattern: e.pattern, primaryMuscles: e.primary, equipment: e.equipment, mechanics: e.mechanics ?? (e.pattern === "isolation" ? "isolation" : "compound"), difficulty: e.difficulty ?? "intermediate", category: e.category ?? "strength", loadProfile: e.load ?? "bodyweight" }));

  it("builds an upper/lower week within the time budget using only available equipment", () => {
    const days = generateProgram({ split: suggestSplit([1, 2, 4, 5], "intermediate"), catalogue, equipment: ["dumbbell", "cable", "machine"], experience: "intermediate", sessionMinutes: 60, goal: "hypertrophy" });
    expect(days.map((d) => d.name)).toEqual(["Upper A", "Lower A", "Upper B", "Lower B"]);
    for (const d of days) {
      expect(d.exercises.length).toBeGreaterThanOrEqual(4);
      expect(d.estimatedMinutes).toBeLessThanOrEqual(60);
      for (const e of d.exercises) expect(["dumbbell", "cable", "machine", "bodyweight"]).toContain(EXERCISES.find((x) => x.slug === e.slug)!.equipment);
    }
    // A and B days vary their main lifts.
    expect(days[0]!.exercises[0]!.slug).not.toBe(days[2]!.exercises[0]!.slug);
  });

  it("uses linear 5s on barbell main lifts for strength goals and fits short sessions", () => {
    const days = generateProgram({ split: suggestSplit([1, 3, 5], "intermediate"), catalogue, equipment: ["barbell", "dumbbell", "cable", "machine", "pullup_bar"], experience: "intermediate", sessionMinutes: 35, goal: "strength" });
    const main = days[0]!.exercises[0]!;
    expect(main.prescription).toMatchObject({ scheme: "linear", repRange: { min: 5, max: 5 } });
    expect(days.every((d) => d.estimatedMinutes <= 35)).toBe(true);
  });

  it("returns an API draft that can be saved as a program", async () => {
    const u = await user();
    const gen = (await t.app.inject({ method: "POST", url: "/v1/programs/generate", headers: u.headers, payload: { preferredDays: [1, 3, 5], sessionMinutes: 50 } })).json();
    expect(gen.draft.days).toHaveLength(3);
    const saved = await t.app.inject({ method: "POST", url: "/v1/programs", headers: u.headers, payload: gen.draft });
    expect(saved.statusCode).toBe(201);
    const p = saved.json();
    expect(p.days[0].exercises.length).toBeGreaterThan(2);
    // Editing creates a new version and keeps the old one.
    const edited = await t.app.inject({ method: "PUT", url: `/v1/programs/${p.id}`, headers: u.headers, payload: { ...gen.draft, name: "Edited", changeReason: "swap" } });
    expect(edited.json()).toMatchObject({ version: 2, parentProgramId: p.id });
    const versions = (await t.app.inject({ method: "GET", url: `/v1/programs/${edited.json().id}/versions`, headers: u.headers })).json();
    expect(versions.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const start = (await t.app.inject({ method: "GET", url: `/v1/templates/${edited.json().days[0].id}/start?minutes=25`, headers: u.headers })).json();
    expect(start.items.length).toBeGreaterThan(0);
    expect(start.items[0].recommendation.action).toBe("establish_baseline");
    expect(start.shortened).toBe(true);
  });
});

describe("workout logging", () => {
  it("completes a session with summary, PRs and next targets; replays are idempotent", async () => {
    const u = await user();
    const ex = await exerciseId(u.headers, "incline dumbbell press");
    const id1 = randomUUID();
    const first = await t.app.inject({ method: "PUT", url: `/v1/workouts/${id1}`, headers: u.headers, payload: workout("2026-10-20", ex, [[30, 10], [30, 10], [30, 9]]) });
    expect(first.statusCode).toBe(200);
    expect(first.json().summary.personalRecords).toEqual([]); // baseline, not a PR

    const id2 = randomUUID();
    const body2 = workout("2026-10-24", ex, [[30, 12], [30, 12], [30, 11]]);
    const second = await t.app.inject({ method: "PUT", url: `/v1/workouts/${id2}`, headers: u.headers, payload: body2 });
    const s = second.json().summary;
    expect(s).toMatchObject({ exercises: 1, workSets: 3, totalReps: 35, volumeKg: 1050, durationSec: 3600 });
    expect(s.personalRecords.map((p: { kind: string }) => p.kind)).toContain("e1rm");
    expect(s.nextTargets[0]).toMatchObject({ action: "increase_reps", targetLoadKg: 30, targetReps: [12, 12, 12], requiresConfirmation: true });
    expect(s.comparison[0].previousE1rmKg).toBeLessThan(s.comparison[0].e1rmKg);

    const replay = await t.app.inject({ method: "PUT", url: `/v1/workouts/${id2}`, headers: u.headers, payload: body2 });
    expect(replay.json().applied).toBe(false);
    const hist = (await t.app.inject({ method: "GET", url: `/v1/exercises/${ex}/history`, headers: u.headers })).json();
    expect(hist.sessions).toHaveLength(2);
    expect(hist.personalRecords.length).toBeGreaterThan(0);
  });

  it("keeps active sessions out of history and supports discard", async () => {
    const u = await user();
    const ex = await exerciseId(u.headers, "lat pulldown");
    const id = randomUUID();
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${id}`, headers: u.headers, payload: workout("2026-10-25", ex, [[50, 10]], "active", { clientUpdatedAt: "2026-10-25T16:20:00Z" }) });
    expect((await t.app.inject({ method: "GET", url: `/v1/exercises/${ex}/history`, headers: u.headers })).json().sessions).toHaveLength(0);
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${id}`, headers: u.headers, payload: workout("2026-10-25", ex, [[50, 10]], "active", { status: "discarded", clientUpdatedAt: "2026-10-25T16:30:00Z" }) });
    const list = (await t.app.inject({ method: "GET", url: "/v1/workouts", headers: u.headers })).json();
    expect(list.items).toHaveLength(0);
  });

  it("rejects unknown exercises and another user's ids", async () => {
    const u = await user();
    const bad = await t.app.inject({ method: "PUT", url: `/v1/workouts/${randomUUID()}`, headers: u.headers, payload: workout("2026-10-25", randomUUID(), [[10, 10]]) });
    expect(bad.statusCode).toBe(400);
    const a = await user();
    const ex = await exerciseId(a.headers, "leg press");
    const id = randomUUID();
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${id}`, headers: a.headers, payload: workout("2026-10-25", ex, [[100, 10]]) });
    const b = await user();
    const steal = await t.app.inject({ method: "PUT", url: `/v1/workouts/${id}`, headers: b.headers, payload: workout("2026-10-25", ex, [[100, 10]], "completed", { clientUpdatedAt: "2026-10-26T00:00:00Z" }) });
    expect(steal.statusCode).toBe(409);
    expect((await t.app.inject({ method: "GET", url: `/v1/workouts/${id}`, headers: b.headers })).statusCode).toBe(404);
  });

  it("reports weekly sets per muscle", async () => {
    const u = await user();
    const ex = await exerciseId(u.headers, "barbell bench press");
    const today = new Date().toISOString().slice(0, 10);
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${randomUUID()}`, headers: u.headers, payload: workout(today, ex, [[80, 8], [80, 8], [80, 7]]) });
    const a = (await t.app.inject({ method: "GET", url: "/v1/training/analytics?weeks=2", headers: u.headers })).json();
    const wk = a.weeks.at(-1);
    expect(wk.setsPerMuscle.chest).toBe(3);
    expect(wk.setsPerMuscle.triceps).toBe(1.5);
  });
});

describe("progress", () => {
  it("records weigh-ins with original units and computes a trend only when data suffices", async () => {
    const u = await user();
    const today = new Date().toISOString().slice(0, 10);
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const r = await t.app.inject({ method: "PUT", url: `/v1/measurements/${randomUUID()}`, headers: u.headers, payload: { day: today, measuredAt: new Date().toISOString(), kind: "weight", value: 84.6, originalValue: 186.5, originalUnit: "lb", clientUpdatedAt: new Date().toISOString() } });
    expect(r.json().applied).toBe(true);
    let w = (await t.app.inject({ method: "GET", url: "/v1/progress/weight", headers: u.headers })).json();
    expect(w.rate.sufficiency).toBe("insufficient");
    for (let i = 1; i <= 24; i++) {
      await t.app.inject({ method: "PUT", url: `/v1/measurements/${randomUUID()}`, headers: u.headers, payload: { day: day(i), measuredAt: new Date(Date.now() - i * 86400000).toISOString(), kind: "weight", value: 85 + i * 0.07 + (i % 3 === 0 ? 0.5 : -0.2), clientUpdatedAt: new Date().toISOString() } });
    }
    w = (await t.app.inject({ method: "GET", url: "/v1/progress/weight", headers: u.headers })).json();
    expect(w.rate.sufficiency).toBe("good");
    expect(w.rate.kgPerWeek).toBeLessThan(0);
    const impossible = await t.app.inject({ method: "PUT", url: `/v1/measurements/${randomUUID()}`, headers: u.headers, payload: { day: today, measuredAt: new Date().toISOString(), kind: "weight", value: 900, clientUpdatedAt: new Date().toISOString() } });
    expect(impossible.statusCode).toBe(400);
  });

  it("stores progress photos privately and serves them only via valid signed URLs", async () => {
    const u = await user();
    const img = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
    const boundary = "----b" + Date.now();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="day"\r\n\r\n2026-10-28\r\n--${boundary}\r\nContent-Disposition: form-data; name="view"\r\n\r\nfront\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      img,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await t.app.inject({ method: "POST", url: "/v1/progress-photos", headers: { ...u.headers, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(up.statusCode).toBe(201);
    const url = new URL(up.json().url);
    const ok = await t.app.inject({ method: "GET", url: url.pathname + url.search });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/jpeg");
    const tampered = await t.app.inject({ method: "GET", url: url.pathname + url.search.replace(/sig=[^&]+/, "sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAA") });
    expect(tampered.statusCode).toBe(403);
    const other = await user();
    expect((await t.app.inject({ method: "GET", url: "/v1/progress-photos", headers: other.headers })).json().items).toHaveLength(0);
    const del = await t.app.inject({ method: "DELETE", url: `/v1/progress-photos/${up.json().id}`, headers: u.headers });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: url.pathname + url.search })).statusCode).toBe(404);
  });
});

describe("health integrations", () => {
  it("deduplicates re-synced samples and maps body mass to weigh-ins", async () => {
    const u = await user();
    const obs = [
      { sourceRecordId: "hk-1", type: "steps", startAt: "2026-10-28T05:00:00Z", endAt: "2026-10-28T06:00:00Z", value: 3200 },
      { sourceRecordId: "hk-2", type: "sleep_minutes", startAt: "2026-10-27T19:00:00Z", endAt: "2026-10-28T02:30:00Z", value: 450 },
      { sourceRecordId: "hk-3", type: "body_mass_kg", startAt: "2026-10-28T03:00:00Z", endAt: "2026-10-28T03:00:00Z", value: 84.2 },
    ];
    const r1 = (await t.app.inject({ method: "POST", url: "/v1/health/observations", headers: u.headers, payload: { provider: "healthkit", observations: obs } })).json();
    expect(r1).toMatchObject({ inserted: 3, weightsAdded: 1 });
    const r2 = (await t.app.inject({ method: "POST", url: "/v1/health/observations", headers: u.headers, payload: { provider: "healthkit", observations: obs } })).json();
    expect(r2).toMatchObject({ inserted: 0, duplicates: 3, weightsAdded: 0 });
    const weights = (await t.app.inject({ method: "GET", url: "/v1/measurements?kind=weight", headers: u.headers })).json();
    expect(weights.items.filter((w: { source: string }) => w.source === "healthkit")).toHaveLength(1);
    const rec = (await t.app.inject({ method: "GET", url: "/v1/recovery/summary", headers: u.headers })).json();
    expect(rec.explanation).toMatch(/no single recovery score/i);
    expect(rec.readiness).toBeDefined();
  });

  it("does not double count steps and sleep recorded by both phone and watch", async () => {
    const u = await user();
    // Noon UTC yesterday falls on yesterday's date in the default profile time zone.
    const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const at = (h: number) => `${y}T${String(h).padStart(2, "0")}:00:00Z`;
    const obs = [
      { sourceRecordId: "p-1", type: "steps", startAt: at(9), endAt: at(10), value: 2500, sourceName: "iPhone" },
      { sourceRecordId: "p-2", type: "steps", startAt: at(11), endAt: at(12), value: 3500, sourceName: "iPhone" },
      { sourceRecordId: "w-1", type: "steps", startAt: at(9), endAt: at(12), value: 7000, sourceName: "Apple Watch" },
      { sourceRecordId: "ps-1", type: "sleep_minutes", startAt: at(1), endAt: at(8), value: 420, sourceName: "iPhone" },
      { sourceRecordId: "ws-1", type: "sleep_minutes", startAt: at(1), endAt: at(4), value: 180, sourceName: "Apple Watch" },
      { sourceRecordId: "ws-2", type: "sleep_minutes", startAt: at(4), endAt: at(8), value: 210, sourceName: "Apple Watch" },
    ];
    expect((await t.app.inject({ method: "POST", url: "/v1/health/observations", headers: u.headers, payload: { provider: "healthkit", observations: obs } })).json()).toMatchObject({ inserted: 6 });
    const rec = (await t.app.inject({ method: "GET", url: "/v1/recovery/summary", headers: u.headers })).json();
    expect(rec.steps.find((s: { day: string }) => s.day === y)?.steps).toBe(7000);
    const sig = rec.signals.find((s: { day: string }) => s.day === y);
    expect(sig.sleepMinutes).toBe(420);
  });
});
