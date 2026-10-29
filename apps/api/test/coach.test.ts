import { randomUUID } from "node:crypto";
import { addDays, dayKeyInZone, startOfIsoWeek } from "@stoke/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAiProvider } from "../src/ai/fake";
import { DisabledAiProvider } from "../src/ai/provider";
import { upsertSharedFood } from "../src/foods/repository";
import { mapFdcFood } from "../src/foods/sources";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

let t: TestApp;
let ai: FakeAiProvider;
let oatsId: string;
const today = dayKeyInZone(new Date(), "Asia/Dubai");

beforeAll(async () => {
  ai = new FakeAiProvider();
  t = await makeTestApp({ ai });
  oatsId = await upsertSharedFood(t.db.system, mapFdcFood({ fdcId: 900001, description: "Test oats meal", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 100 }, { nutrientNumber: "203", value: 5 }, { nutrientNumber: "205", value: 15 }, { nutrientNumber: "204", value: 2.2 }] })!, new Date());
});
afterAll(async () => t.close());

async function user(consent = { coachUsesHealthData: false, photoAnalysis: false, retainMealPhotos: false }) {
  const u = await registerUser(t.app);
  await onboard(t.app, u.headers);
  await t.app.inject({ method: "PUT", url: "/v1/profile/ai-consent", headers: u.headers, payload: consent });
  return u;
}

/** 28 days of complete logging at a fixed intake, with weight falling ~1 kg/week. */
async function seedHistory(headers: Record<string, string>, kcal: number, kgPerWeek: number) {
  for (let i = 27; i >= 0; i--) {
    const day = addDays(today, -i);
    for (const meal of ["breakfast", "dinner"]) {
      await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers, payload: { day, loggedAt: `${day}T08:00:00Z`, clientUpdatedAt: `${day}T08:00:00Z`, meal, foodId: oatsId, portion: { kind: "amount", quantity: kcal / 2, unit: "g" } } });
    }
    await t.app.inject({ method: "PUT", url: `/v1/diary/${day}/status`, headers, payload: { status: "complete" } });
    const kg = 90 + (kgPerWeek / 7) * (27 - i) + Math.sin(i) * 0.4;
    await t.app.inject({ method: "PUT", url: `/v1/measurements/${randomUUID()}`, headers, payload: { day, measuredAt: `${day}T05:00:00Z`, kind: "weight", value: kg, clientUpdatedAt: `${day}T05:00:00Z` } });
  }
}

describe("adaptive nutrition", () => {
  it("proposes a capped change backed by evidence and applies it only on acceptance", async () => {
    const u = await user();
    const before = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json().current;
    // Eating exactly the target but losing ~1 kg/week: the target is lower than intended.
    await seedHistory(u.headers, before.energyKcal, -1.0);
    const check = (await t.app.inject({ method: "POST", url: "/v1/nutrition/adaptive-check", headers: u.headers })).json();
    expect(check.result.status).toBe("adjust");
    expect(check.result.changeKcal).toBeGreaterThan(0);
    expect(Math.abs(check.result.changeKcal)).toBeLessThanOrEqual(150);
    const rec = check.recommendation;
    // Nothing changed yet.
    expect((await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json().current.energyKcal).toBe(before.energyKcal);

    const accept = await t.app.inject({ method: "POST", url: `/v1/coach/recommendations/${rec.id}/decision`, headers: u.headers, payload: { decision: "accept" } });
    expect(accept.statusCode).toBe(200);
    const after = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json();
    expect(after.current.basis).toBe("adapted");
    expect(after.current.energyKcal).toBe(rec.payload.energyKcal);
    expect(after.history.length).toBe(2);
    const list = (await t.app.inject({ method: "GET", url: "/v1/coach/recommendations", headers: u.headers })).json();
    expect(list.items[0].actions[0]).toMatchObject({ action: "nutrition_targets.updated", before: { energyKcal: before.energyKcal } });
    const again = await t.app.inject({ method: "POST", url: `/v1/coach/recommendations/${rec.id}/decision`, headers: u.headers, payload: { decision: "accept" } });
    expect(again.statusCode).toBe(409);
    const other = await user();
    expect((await t.app.inject({ method: "POST", url: `/v1/coach/recommendations/${rec.id}/decision`, headers: other.headers, payload: { decision: "reject" } })).statusCode).toBe(404);
  });

  it("reports an adherence gap rather than lowering the target when the user eats well below it", async () => {
    const u = await user();
    await seedHistory(u.headers, 1800, -0.8);
    const check = (await t.app.inject({ method: "POST", url: "/v1/nutrition/adaptive-check", headers: u.headers })).json();
    expect(check.result.status).toBe("adherence_gap");
    expect(check.recommendation).toBeNull();
  });

  it("reports insufficient data instead of guessing", async () => {
    const u = await user();
    const check = (await t.app.inject({ method: "POST", url: "/v1/nutrition/adaptive-check", headers: u.headers })).json();
    expect(check.result.status).toBe("insufficient_data");
    expect(check.recommendation).toBeNull();
  });
});

describe("AI coach", () => {
  it("answers from tool data and keeps tool traffic out of the visible transcript", async () => {
    const u = await user();
    await t.app.inject({ method: "PUT", url: `/v1/food-logs/${randomUUID()}`, headers: u.headers, payload: { day: today, loggedAt: new Date().toISOString(), clientUpdatedAt: new Date().toISOString(), meal: "lunch", foodId: oatsId, portion: { kind: "amount", quantity: 400, unit: "g" } } });
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "Let me check." }, { type: "tool_call", id: "call_1", name: "get_nutrition_summary", input: { days: 1 } }] });
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "Logged: 400 kcal and 20 g protein today." }] });
    const res = await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "Am I eating enough protein?" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reply: "Logged: 400 kcal and 20 g protein today.", toolCalls: [{ name: "get_nutrition_summary", isError: false }] });
    // The tool result the model saw contains the user's real logged numbers.
    const last = ai.calls.at(-1)!.messages as { role: string; parts: { type: string; content?: string }[] }[];
    const toolResult = last.flatMap((m) => m.parts).find((p) => p.type === "tool_result")!;
    const data = JSON.parse(toolResult.content!);
    expect(data.days[0]).toMatchObject({ day: today, energyKcal: 400, proteinG: 20 });
    expect(ai.calls.at(-1)!.system).toMatch(/Never invent history/);
    const transcript = (await t.app.inject({ method: "GET", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers })).json();
    expect(transcript.items.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("replays the full stored history (append-only) on the next turn", async () => {
    const u = await user();
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "First answer." }], native: [{ type: "text", text: "First answer." }] });
    await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "Hi" } });
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "Second answer." }] });
    await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "And now?" } });
    const msgs = ai.calls.at(-1)!.messages as { role: string; native?: unknown }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[1]!.native).toEqual([{ type: "text", text: "First answer." }]);
  });

  it("asks for Arabic replies when the app language is Arabic", async () => {
    const u = await user();
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    const lastUserText = () => ((ai.calls.at(-1)!.messages as { role: string; parts: { type: string; text?: string }[] }[]).at(-1)!.parts[0]!.text ?? "");
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "أهلًا" }] });
    await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: { ...u.headers, "accept-language": "ar" }, payload: { text: "كم بروتين أحتاج؟" } });
    expect(lastUserText()).toContain("reply in Modern Standard Arabic");
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "Hi" }] });
    await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: { ...u.headers, "accept-language": "en" }, payload: { text: "Hi" } });
    expect(lastUserText()).not.toContain("Arabic");
  });

  it("can only propose; unsafe targets are refused by the tool; substitutions create a new program version", async () => {
    const u = await user();
    const gen = (await t.app.inject({ method: "POST", url: "/v1/programs/generate", headers: u.headers, payload: { preferredDays: [1, 3, 5] } })).json();
    const program = (await t.app.inject({ method: "POST", url: "/v1/programs", headers: u.headers, payload: gen.draft })).json();
    const te = program.days[0].exercises[0];
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    ai.queueAgent({ role: "assistant", parts: [
      { type: "tool_call", id: "a", name: "propose_nutrition_targets", input: { energyKcal: 1000, proteinG: 120, carbsG: 50, fatG: 22, reason: "fast cut" } },
      { type: "tool_call", id: "b", name: "propose_exercise_substitution", input: { templateExerciseId: te.id, replacementSlug: "leg-press", reason: "No rack available" } },
    ] });
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "I suggested swapping to the leg press. Review it in Suggestions." }] });
    const res = (await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "No squat rack today, and I want to cut fast" } })).json();
    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0]).toMatchObject({ kind: "exercise_substitution", status: "proposed" });
    const toolMsgs = (ai.calls.at(-1)!.messages as { parts: { type: string; content?: string }[] }[]).flatMap((m) => m.parts).filter((p) => p.type === "tool_result");
    expect(JSON.parse(toolMsgs[0]!.content!)).toMatchObject({ ok: false });

    const accept = (await t.app.inject({ method: "POST", url: `/v1/coach/recommendations/${res.recommendations[0].id}/decision`, headers: u.headers, payload: { decision: "accept" } })).json();
    const newProgram = (await t.app.inject({ method: "GET", url: `/v1/programs/${accept.result.programId}`, headers: u.headers })).json();
    expect(newProgram).toMatchObject({ version: 2, parentProgramId: program.id, createdBy: "ai", status: "active" });
    expect(newProgram.days[0].exercises[0].exercise.slug).toBe("leg-press");
    const old = (await t.app.inject({ method: "GET", url: `/v1/programs/${program.id}`, headers: u.headers })).json();
    expect(old.status).toBe("archived");
    expect(old.days[0].exercises[0].exerciseId).toBe(te.exerciseId);
  });

  it("withholds health data unless the user consented", async () => {
    const u = await user();
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    ai.queueAgent({ role: "assistant", parts: [{ type: "tool_call", id: "r", name: "get_recovery_summary", input: {} }] });
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "ok" }] });
    await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "How is my recovery?" } });
    const tr = (ai.calls.at(-1)!.messages as { parts: { type: string; content?: string }[] }[]).flatMap((m) => m.parts).find((p) => p.type === "tool_result")!;
    expect(JSON.parse(tr.content!)).toMatchObject({ available: false });
  });

  it("returns validation errors for bad tool input instead of executing", async () => {
    const u = await user();
    const conv = (await t.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    ai.queueAgent({ role: "assistant", parts: [{ type: "tool_call", id: "x", name: "get_nutrition_summary", input: { days: 9999 } }] });
    ai.queueAgent({ role: "assistant", parts: [{ type: "text", text: "Sorry." }] });
    const res = (await t.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "Summary of my whole life" } })).json();
    expect(res.toolCalls[0]).toMatchObject({ isError: true });
  });
});

describe("today and weekly review", () => {
  it("assembles the Today screen", async () => {
    const u = await user();
    const day = (await t.app.inject({ method: "GET", url: "/v1/today", headers: u.headers })).json();
    expect(day).toMatchObject({ day: today, nutrition: { targets: { basis: "estimated" } }, recovery: { readiness: "good" } });
    expect(day.insights.find((i: { id: string }) => i.id === "protein_remaining")).toBeTruthy();
    const review = (await t.app.inject({ method: "GET", url: "/v1/coach/weekly-review", headers: u.headers })).json();
    expect(review.labels.observed).toContain("sessionsCompleted");
  });

  it("names the exercises that set records instead of counting every record type", async () => {
    const u = await user();
    const weekStart = startOfIsoWeek(addDays(today, -7));
    const ex = (await t.app.inject({ method: "GET", url: "/v1/exercises?q=barbell%20bench%20press", headers: u.headers })).json().items[0];
    const session = (day: string, kg: number, reps: number) => ({ name: "Push", day, startedAt: `${day}T06:00:00Z`, endedAt: `${day}T07:00:00Z`, pausedSec: 0, status: "completed", clientUpdatedAt: `${day}T07:00:00Z`, exercises: [{ id: randomUUID(), exerciseId: ex.id, position: 0, sets: [0, 1, 2].map((i) => ({ id: randomUUID(), position: i, kind: "working", weightKg: kg, reps, completed: true, completedAt: null, originalUnit: "kg" })) }] });
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${randomUUID()}`, headers: u.headers, payload: session(weekStart, 80, 8) });
    await t.app.inject({ method: "PUT", url: `/v1/workouts/${randomUUID()}`, headers: u.headers, payload: session(addDays(weekStart, 2), 90, 8) });
    const review = (await t.app.inject({ method: "GET", url: "/v1/coach/weekly-review", headers: u.headers })).json();
    expect(review.training.sessionsCompleted).toBe(2);
    expect(review.training.personalRecords).toBeGreaterThan(1);
    expect(review.training.prExercises).toEqual([ex.name]);
  });
});

describe("coach without AI configured", () => {
  it("fails clearly", async () => {
    const t2 = await makeTestApp({ ai: new DisabledAiProvider() });
    const u = await registerUser(t2.app);
    const conv = (await t2.app.inject({ method: "POST", url: "/v1/coach/conversations", headers: u.headers })).json();
    const res = await t2.app.inject({ method: "POST", url: `/v1/coach/conversations/${conv.id}/messages`, headers: u.headers, payload: { text: "hi" } });
    expect(res.statusCode).toBe(503);
    await t2.close();
  });
});
