import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => t.close());

describe("goal-specific targets and programs", () => {
  it("previews targets for the current goals with reasons, and applies them only when asked", async () => {
    const u = await registerUser(t.app);
    await onboard(t.app, u.headers, { goals: [{ kind: "build_muscle", priority: 1 }, { kind: "lose_fat", priority: 2 }] });
    const before = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json().current;
    const rec = (await t.app.inject({ method: "GET", url: "/v1/nutrition/targets/recommended", headers: u.headers })).json();
    expect(rec.goal).toBe("build_muscle");
    expect(rec.targets.rationale[0]).toMatch(/Muscle gain/);
    expect(rec.targets.rationale.join(" ")).toMatch(/halved/); // the fat-loss secondary goal trims the surplus
    expect((await t.app.inject({ method: "GET", url: "/v1/nutrition/targets", headers: u.headers })).json().current.id).toBe(before.id);
    const applied = await t.app.inject({ method: "POST", url: "/v1/nutrition/targets/recalculate", headers: u.headers });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({ energyKcal: rec.targets.energyKcal, proteinG: rec.targets.proteinG, basis: "estimated" });
  });

  it("explains and shapes the program for the goal", async () => {
    const u = await registerUser(t.app);
    await onboard(t.app, u.headers, { goals: [{ kind: "lose_fat", priority: 1 }] });
    const gen = (await t.app.inject({ method: "POST", url: "/v1/programs/generate", headers: u.headers, payload: { preferredDays: [1, 3, 5], sessionMinutes: 60, equipment: ["barbell", "dumbbell", "cable", "machine", "cardio_machine"] } })).json();
    expect(gen.focus).toBe("fat_loss");
    expect(gen.rationale).toMatch(/Fat loss/);
    expect(gen.preview.filter((d: { exercises: { prescription: { restSec: number; repRange: { max: number } } }[] }) => d.exercises.some((e) => e.prescription.restSec === 0 && e.prescription.repRange.max === 15))).toHaveLength(3);
    const plan = (await t.app.inject({ method: "POST", url: "/v1/onboarding/plan", headers: u.headers, payload: { sex: "female", birthDate: "1995-01-01", heightCm: 165, weightKg: 62, activityLevel: "light", goals: [{ kind: "strength", priority: 1 }], training: { experience: "intermediate", preferredDays: [1, 3, 5] } } })).json();
    expect(plan.training.focus).toBe("strength");
    expect(plan.training.rationale).toMatch(/Strength: heavy/);
    expect(plan.targets.rationale[0]).toMatch(/Strength/);
  });
});
