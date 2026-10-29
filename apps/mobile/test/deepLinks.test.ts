import { describe, expect, it } from "vitest";
import { buildLogUrl, MAX_LOG_TEXT, normalizeLogText, parseIncoming, parseQuery, resolveDeepLink } from "../src/features/native/deepLinks";

const idle = { hasActiveWorkout: false };

describe("deep links", () => {
  it("routes stoke://log?text= to the voice screen with the decoded text", () => {
    expect(resolveDeepLink("stoke://log?text=two%20eggs%20and%20toast", idle)).toBe("/food/voice?text=two%20eggs%20and%20toast");
    expect(resolveDeepLink("stoke://log?text=200g+chicken+%26+rice", idle)).toBe(`/food/voice?text=${encodeURIComponent("200g chicken & rice")}`);
    expect(resolveDeepLink("stoke://log", idle)).toBe("/food/voice");
    expect(resolveDeepLink("stoke://log?text=%20%20", idle)).toBe("/food/voice");
  });

  it("round-trips any text through buildLogUrl", () => {
    for (const t of ["2 eggs + toast", "café au lait 250 ml", "a=b&c=d", "100% juice", "🍳 omelette"]) {
      const route = resolveDeepLink(buildLogUrl(t), idle)!;
      const { query } = parseIncoming(route);
      expect(normalizeLogText(query.text)).toBe(t);
    }
  });

  it("opens Train, or resumes the active workout, for stoke://workout/start", () => {
    expect(resolveDeepLink("stoke://workout/start", idle)).toBe("/train");
    expect(resolveDeepLink("stoke://workout/start", { hasActiveWorkout: true })).toBe("/workout/active");
  });

  it("routes stoke://weigh-in and leaves other URLs to the router", () => {
    expect(resolveDeepLink("stoke://weigh-in", idle)).toBe("/weigh-in");
    expect(resolveDeepLink("stoke://nutrition", idle)).toBeNull();
    expect(resolveDeepLink("stoke://workout/active", idle)).toBeNull();
    expect(resolveDeepLink("stoke://log/extra", idle)).toBeNull();
    expect(resolveDeepLink("/food/voice?text=x", idle)).toBeNull();
  });

  it("accepts paths, triple-slash URLs and dev-client URLs", () => {
    expect(resolveDeepLink("/log?text=apple", idle)).toBe("/food/voice?text=apple");
    expect(resolveDeepLink("stoke:///workout/start", idle)).toBe("/train");
    expect(resolveDeepLink("exp+stoke://expo-development-client/--/weigh-in", idle)).toBe("/weigh-in");
  });

  it("parses queries defensively", () => {
    expect(parseQuery("a=1&a=2&b&c=%E0%A4%A")).toEqual({ a: "1", b: "", c: "%E0%A4%A" });
    expect(normalizeLogText(["  two \n eggs ", "ignored"])).toBe("two eggs");
    expect(normalizeLogText(undefined)).toBeNull();
    expect(normalizeLogText("x".repeat(MAX_LOG_TEXT + 50))).toHaveLength(MAX_LOG_TEXT);
  });
});
