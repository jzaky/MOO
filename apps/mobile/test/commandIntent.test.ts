import { describe, expect, it, vi } from "vitest";
import { storageMock } from "./mocks";
vi.mock("../src/lib/storage", () => storageMock);
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "en" }] }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, I18nManager: { isRTL: false, allowRTL: () => {}, forceRTL: () => {} } }));
vi.mock("../src/lib/data", () => ({ defaultMealForNow: () => "lunch", logFood: vi.fn(), logWater: vi.fn(), logWeight: vi.fn() }));
vi.mock("../src/features/workout/store", () => ({ addExercise: vi.fn(), addSet: vi.fn(), getActiveWorkout: () => null, removeSet: vi.fn(), updateSet: vi.fn() }));
const { intentOf, matchWorkout } = await import("../src/features/command/draft");

describe("command bar intent", () => {
  it("routes questions to the coach", () => {
    expect(intentOf("how's my protein today?").kind).toBe("ask");
    expect(intentOf("Should I eat more carbs").kind).toBe("ask");
    expect(intentOf("كيف حال البروتين اليوم").kind).toBe("ask");
    expect(intentOf("protein left?").kind).toBe("ask");
  });
  it("keeps food that looks like a question opener as a log", () => {
    expect(intentOf("can of tuna").kind).toBe("log");
    expect(intentOf("2 cans of coke").kind).toBe("log");
    expect(intentOf("2 eggs, labneh and karak")).toEqual({ kind: "log", text: "2 eggs, labneh and karak" });
    expect(intentOf("weighed 82.4 kg").kind).toBe("log");
    expect(intentOf("can I have pizza tonight").kind).toBe("ask");
  });
  it("recognises starting a workout", () => {
    expect(intentOf("start upper A")).toEqual({ kind: "start", query: "upper A" });
    expect(intentOf("Start my workout")).toEqual({ kind: "start", query: "" });
    expect(intentOf("start")).toEqual({ kind: "start", query: "" });
  });
});

describe("workout matching", () => {
  const days = [{ id: "a", name: "Upper A" }, { id: "b", name: "Lower A" }, { id: "c", name: "Upper B" }];
  it("matches by name, case-insensitively", () => {
    expect(matchWorkout("upper a", days, null)?.id).toBe("a");
    expect(matchWorkout("lower", days, null)?.id).toBe("b");
  });
  it("uses the next workout for a generic request", () => {
    expect(matchWorkout("", days, days[2]!)?.id).toBe("c");
    expect(matchWorkout("next", days, days[1]!)?.id).toBe("b");
  });
  it("never guesses an unrelated day", () => {
    expect(matchWorkout("legs", days, days[0]!)).toBeNull();
  });
});
