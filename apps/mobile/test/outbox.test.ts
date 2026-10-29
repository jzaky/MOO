import { beforeEach, describe, expect, it, vi } from "vitest";
import { memory, storageMock } from "./mocks";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("../src/lib/storage", () => storageMock);
const apiMock = vi.fn();
vi.mock("../src/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/api")>()), api: (...a: unknown[]) => apiMock(...a) }));

const { ApiError } = await import("../src/lib/api");
const outbox = await import("../src/lib/outbox");

beforeEach(() => {
  outbox.clearOutbox();
  apiMock.mockReset();
  memory.clear();
});

const offline = () => Promise.reject(new ApiError(0, "network", "offline"));

describe("offline outbox", () => {
  it("coalesces repeated writes to the same resource and sends only the latest", async () => {
    apiMock.mockImplementation(offline);
    outbox.enqueue({ method: "PUT", path: "/v1/food-logs/a", body: { v: 1 } });
    outbox.enqueue({ method: "PUT", path: "/v1/food-logs/a", body: { v: 2 } });
    outbox.enqueue({ method: "PUT", path: "/v1/water-logs/b", body: { v: 1 } });
    await outbox.flush();
    expect(outbox.pendingOps().map((o) => [o.path, (o.body as { v: number }).v])).toEqual([["/v1/food-logs/a", 2], ["/v1/water-logs/b", 1]]);

    apiMock.mockReset().mockResolvedValue({});
    await outbox.flush();
    expect(apiMock.mock.calls.map((c) => [c[0], (c[1] as { body: { v: number } }).body.v])).toEqual([["/v1/food-logs/a", 2], ["/v1/water-logs/b", 1]]);
    expect(outbox.pendingOps()).toHaveLength(0);
  });

  it("keeps order and stops at the first retryable failure", async () => {
    apiMock.mockImplementation(offline);
    apiMock.mockImplementationOnce(() => Promise.reject(new ApiError(503, "unavailable", "down")));
    outbox.enqueue({ method: "PUT", path: "/v1/x/1" });
    await outbox.flush();
    outbox.enqueue({ method: "PUT", path: "/v1/x/2" });
    await outbox.flush();
    // Only the first op was attempted on each flush; the second waits behind it.
    expect(apiMock.mock.calls.every((c) => c[0] === "/v1/x/1")).toBe(true);
    expect(outbox.pendingOps().map((o) => [o.path, o.failed ?? false])).toEqual([["/v1/x/1", false], ["/v1/x/2", false]]);
    expect(outbox.pendingOps()[0]!.attempts).toBeGreaterThanOrEqual(2);
  });

  it("marks validation errors as failed (kept for the user) but keeps sending the rest", async () => {
    apiMock.mockImplementation((path: string) => (path === "/v1/bad" ? Promise.reject(new ApiError(400, "validation_error", "bad")) : Promise.resolve({})));
    // "/v1/good" is enqueued while the first flush is still in flight; it must go out in that same flush.
    outbox.enqueue({ method: "PUT", path: "/v1/bad" });
    outbox.enqueue({ method: "PUT", path: "/v1/good" });
    await outbox.flush();
    expect(apiMock.mock.calls.map((c) => c[0])).toEqual(["/v1/bad", "/v1/good"]);
    expect(outbox.pendingOps().map((o) => [o.path, !!o.failed])).toEqual([["/v1/bad", true]]);
    outbox.discardFailed("PUT /v1/bad");
    expect(outbox.pendingOps()).toHaveLength(0);
  });

  it("survives a restart: the queue is persisted", () => {
    apiMock.mockImplementation(offline);
    outbox.enqueue({ method: "DELETE", path: "/v1/food-logs/z" });
    expect(storageMock.kv.get<unknown[]>("outbox.v1")).toHaveLength(1);
  });
});
