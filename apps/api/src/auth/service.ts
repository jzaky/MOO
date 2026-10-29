import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, isNull, sql } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "../config";
import type { Database } from "../db/client";
import { auditEvents, notificationPreferences, profiles, refreshTokens, subscriptions, users } from "../db/schema";
import { conflict, unauthorized } from "../http/errors";

/**
 * Email/password auth with short-lived access JWTs and rotating, hashed
 * refresh tokens. Reusing a rotated refresh token revokes the whole token
 * family (theft detection). The AuthService interface is the seam for
 * swapping in a hosted provider (e.g. Supabase Auth) later.
 */

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; email: string };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// Pre-computed hash used to equalize timing when the email does not exist.
let dummyHash: Promise<string> | null = null;

export class AuthService {
  private readonly key: Uint8Array;

  constructor(private readonly db: Database, private readonly cfg: Config) {
    this.key = new TextEncoder().encode(cfg.JWT_SECRET);
  }

  async register(email: string, password: string, userAgent?: string): Promise<IssuedTokens> {
    const normalized = email.trim().toLowerCase();
    const passwordHash = await argonHash(password);
    const userId = await this.db.system.transaction(async (tx) => {
      const existing = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalized}`);
      if (existing.length) throw conflict("An account with this email already exists");
      const [u] = await tx.insert(users).values({ email: normalized, passwordHash }).returning({ id: users.id });
      await tx.insert(profiles).values({ userId: u!.id });
      await tx.insert(notificationPreferences).values({ userId: u!.id, settings: {} });
      await tx.insert(subscriptions).values({ userId: u!.id, plan: "free", status: "active" });
      await tx.insert(auditEvents).values({ userId: u!.id, event: "auth.register" });
      return u!.id;
    });
    return this.issue(userId, normalized, randomUUID(), userAgent);
  }

  async login(email: string, password: string, userAgent?: string): Promise<IssuedTokens> {
    const normalized = email.trim().toLowerCase();
    const [u] = await this.db.system.select().from(users).where(sql`lower(${users.email}) = ${normalized}`);
    if (!u) {
      dummyHash ??= argonHash("timing-equalizer-password");
      await argonVerify(await dummyHash, password).catch(() => false);
      throw unauthorized("Email or password is incorrect");
    }
    const ok = await argonVerify(u.passwordHash, password).catch(() => false);
    if (!ok || u.status !== "active") {
      await this.db.system.insert(auditEvents).values({ userId: u.id, event: "auth.login_failed" });
      throw unauthorized("Email or password is incorrect");
    }
    await this.db.system.insert(auditEvents).values({ userId: u.id, event: "auth.login" });
    return this.issue(u.id, u.email, randomUUID(), userAgent);
  }

  async refresh(token: string, userAgent?: string): Promise<IssuedTokens> {
    const tokenHash = sha256(token);
    const [row] = await this.db.system.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    if (!row) throw unauthorized("Invalid refresh token");
    if (row.revokedAt) {
      // Reuse of a rotated token: assume theft, revoke the family.
      await this.db.system.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      await this.db.system.insert(auditEvents).values({ userId: row.userId, event: "auth.refresh_reuse_detected" });
      throw unauthorized("Refresh token was already used; please sign in again");
    }
    if (row.expiresAt.getTime() < Date.now()) throw unauthorized("Refresh token expired");
    const [u] = await this.db.system.select().from(users).where(eq(users.id, row.userId));
    if (!u || u.status !== "active") throw unauthorized();
    const issued = await this.issue(u.id, u.email, row.familyId, userAgent);
    const [newRow] = await this.db.system.select({ id: refreshTokens.id }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(issued.refreshToken)));
    await this.db.system.update(refreshTokens).set({ revokedAt: new Date(), replacedBy: newRow?.id ?? null }).where(eq(refreshTokens.id, row.id));
    return issued;
  }

  async logout(token: string): Promise<void> {
    await this.db.system.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, sha256(token)), isNull(refreshTokens.revokedAt)));
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.system.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async verifyAccessToken(token: string): Promise<{ userId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: "moo", audience: "moo-api" });
      if (typeof payload.sub !== "string") throw new Error("no sub");
      return { userId: payload.sub };
    } catch {
      throw unauthorized("Invalid or expired access token");
    }
  }

  async getUser(userId: string) {
    const [u] = await this.db.system.select({ id: users.id, email: users.email, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
    return u ?? null;
  }

  /** Permanently deletes the account; FK cascades remove all user data. */
  async deleteAccount(userId: string, password: string, beforeDelete?: () => Promise<void>): Promise<void> {
    const [u] = await this.db.system.select().from(users).where(eq(users.id, userId));
    if (!u) throw unauthorized();
    if (!(await argonVerify(u.passwordHash, password).catch(() => false))) throw unauthorized("Password is incorrect");
    await beforeDelete?.();
    await this.db.system.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, userId));
      await tx.insert(auditEvents).values({ userId: null, event: "account.deleted", targetType: "user", targetId: sha256(userId) });
    });
  }

  private async issue(userId: string, email: string, familyId: string, userAgent?: string): Promise<IssuedTokens> {
    const now = Date.now();
    const accessExp = new Date(now + this.cfg.ACCESS_TOKEN_TTL_SEC * 1000);
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("moo")
      .setAudience("moo-api")
      .setIssuedAt()
      .setExpirationTime(Math.floor(accessExp.getTime() / 1000))
      .setJti(randomUUID())
      .sign(this.key);
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExp = new Date(now + this.cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.db.system.insert(refreshTokens).values({ userId, tokenHash: sha256(refreshToken), familyId, expiresAt: refreshExp, userAgent: userAgent?.slice(0, 200) ?? null });
    return {
      accessToken,
      accessTokenExpiresAt: accessExp.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExp.toISOString(),
      user: { id: userId, email },
    };
  }
}
