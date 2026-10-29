import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private media storage (progress photos, meal photos). Objects are stored
 * under a per-user prefix and are only reachable through short-lived HMAC
 * signed URLs. The interface is the seam for S3-compatible storage with
 * presigned URLs in production; encryption at rest is then provided by the
 * bucket (SSE) — for local disk it is the host's responsibility.
 */
export interface MediaStorage {
  put(userId: string, kind: "progress" | "meal" | "label", data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  signedUrl(key: string, ttlSec?: number): string;
  verify(key: string, expires: number, signature: string): boolean;
  ownerOf(key: string): string | null;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly root: string, private readonly secret: string, private readonly publicBaseUrl: string, private readonly now: () => Date = () => new Date()) {}

  async put(userId: string, kind: "progress" | "meal" | "label", data: Buffer, contentType: string): Promise<string> {
    const ext = EXT[contentType];
    if (!ext) throw new Error(`Unsupported content type ${contentType}`);
    const key = `${userId}/${kind}/${randomUUID()}.${ext}`;
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, data, { mode: 0o600 });
    return key;
  }

  async get(key: string) {
    try {
      const data = await readFile(this.resolve(key));
      const ext = key.split(".").pop() ?? "";
      const contentType = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("Invalid user id");
    await rm(path.join(this.root, userId), { recursive: true, force: true });
  }

  signedUrl(key: string, ttlSec = 300): string {
    const expires = Math.floor(this.now().getTime() / 1000) + ttlSec;
    const sig = this.sign(key, expires);
    return `${this.publicBaseUrl}/v1/media/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}`;
  }

  verify(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires < this.now().getTime() / 1000) return false;
    const expected = Buffer.from(this.sign(key, expires));
    const got = Buffer.from(signature);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  ownerOf(key: string): string | null {
    const m = key.match(/^([0-9a-f-]{36})\//);
    return m ? m[1]! : null;
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${key}\n${expires}`).digest("base64url");
  }

  private resolve(key: string): string {
    if (!/^[0-9a-f-]{36}\/(progress|meal|label)\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) throw new Error("Invalid media key");
    return path.join(this.root, key);
  }
}
