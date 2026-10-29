import { vi } from "vitest";

/** In-memory replacement for the SQLite-backed kv store. */
export const memory = new Map<string, string>();
export const storageMock = {
  kv: {
    get: <T,>(k: string): T | null => (memory.has(k) ? (JSON.parse(memory.get(k)!) as T) : null),
    set: (k: string, v: unknown) => void memory.set(k, JSON.stringify(v)),
    remove: (k: string) => void memory.delete(k),
    clearPrefix: (p: string) => [...memory.keys()].filter((k) => k.startsWith(p)).forEach((k) => memory.delete(k)),
  },
  secure: { get: async () => null, set: async () => {}, remove: async () => {} },
};

export const hapticMock = { haptic: vi.fn() };
