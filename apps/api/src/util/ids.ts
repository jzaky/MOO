import { createHash } from "node:crypto";

/**
 * RFC 4122 version-5 style UUID derived from a namespace and a name. Used to
 * make server-side fan-out writes (copying a meal, logging a saved meal)
 * idempotent: replaying the same request produces the same row ids.
 */
export function deterministicUuid(namespace: string, name: string): string {
  const h = createHash("sha1").update(namespace).update("\0").update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
