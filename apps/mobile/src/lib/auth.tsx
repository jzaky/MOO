import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { api, currentRefreshToken, loadTokens, setSignedOutHandler, setTokens } from "./api";
import { clearOutbox } from "./outbox";
import { clearCache } from "./query";
import { kv } from "./storage";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  userId: string | null;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface TokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; email: string };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<{ id: string; email: string } | null>(() => kv.get("auth.user"));

  useEffect(() => {
    setSignedOutHandler(() => {
      setUser(null);
      setStatus("signedOut");
    });
    loadTokens().then((t) => setStatus(t ? "signedIn" : "signedOut"));
  }, []);

  const accept = async (r: TokenResponse) => {
    await setTokens(r);
    kv.set("auth.user", r.user);
    setUser(r.user);
    setStatus("signedIn");
  };

  const value: AuthState = {
    status,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    async signIn(email, password) {
      await accept(await api<TokenResponse>("/v1/auth/login", { body: { email, password }, auth: false }));
    },
    async signUp(email, password) {
      await accept(await api<TokenResponse>("/v1/auth/register", { body: { email, password }, auth: false }));
    },
    async signOut() {
      const rt = currentRefreshToken();
      if (rt) await api("/v1/auth/logout", { body: { refreshToken: rt }, auth: false }).catch(() => {});
      await setTokens(null);
      // Remove every cached copy of personal data from the device.
      clearCache();
      clearOutbox();
      kv.clearPrefix("workout.");
      kv.remove("auth.user");
      setUser(null);
      setStatus("signedOut");
    },
  };
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
