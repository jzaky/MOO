import "expo-sqlite/localStorage/install";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Local persistence.
 *  - `kv`: synchronous key-value store (SQLite-backed `localStorage` on
 *    native, browser localStorage on web) for caches, the outbox and the
 *    active workout. Survives app restarts; works offline.
 *  - `secure`: Keychain/Keystore for credentials (web falls back to
 *    localStorage, which is acceptable only for development builds).
 */

const ls = (): Storage | null => (typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null);

export const kv = {
  get<T>(key: string): T | null {
    try {
      const raw = ls()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      ls()?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable: caller keeps in-memory state */
    }
  },
  remove(key: string): void {
    try {
      ls()?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  clearPrefix(prefix: string): void {
    const s = ls();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  },
};

export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return ls()?.getItem(`secure:${key}`) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return void ls()?.setItem(`secure:${key}`, value);
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") return void ls()?.removeItem(`secure:${key}`);
    await SecureStore.deleteItemAsync(key);
  },
};
