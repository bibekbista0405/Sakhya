"use client";

import { clearCachedPlaintext } from "@/lib/messageStore";
import { clearChatCache } from "@/lib/chatCache";
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, clearToken, getStoredToken } from "@/lib/api";
import { User } from "@/types";
import { ensureDeviceRegistered, maybeTopUpOneTimeKeys, clearActiveCryptoSession } from "@/lib/crypto";
import { closeAllBrowserNotifications } from "@/lib/browserNotifications";

interface RegisterPayload {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    setTokenState(stored);
    api
      .get<{ user: User }>("/auth/me")
      .then(async (res) => {
        setUser(res.user);
        // Authentication must not be blocked by cold-start E2EE/WASM/IndexedDB
        // work. The crypto layer independently waits for registration when a
        // message actually needs it. This keeps the first navigation responsive.
        void ensureDeviceRegistered(res.user.id).catch((err) => {
          console.error("Background device registration failed:", err);
        });
      })
      .catch(() => {
        clearToken();
        setTokenState(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await api.post<{ user: User; token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(res.token, remember);
      setTokenState(res.token);
      setUser(res.user);
      // Do not make login navigation wait for libolm/WASM, IndexedDB, key
      // generation, and /devices/register. encrypt/decrypt paths call
      // ensureDeviceRegistered themselves when crypto is actually needed.
      router.push("/chats");
      void ensureDeviceRegistered(res.user.id).catch((err) => {
        console.error("Background device registration failed:", err);
      });
    },
    [router]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const res = await api.post<{ user: User; token: string }>("/auth/register", payload);
      setToken(res.token, true);
      setTokenState(res.token);
      setUser(res.user);
      // Account creation should become interactive immediately; E2EE setup
      // continues in the background and is awaited only by crypto operations.
      router.push("/chats");
      void ensureDeviceRegistered(res.user.id).catch((err) => {
        console.error("Background device registration failed:", err);
      });
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore network errors on logout
    }
    closeAllBrowserNotifications();
    // Logout is a privacy boundary: keep long-lived E2EE identity keys, but
    // remove decrypted message plaintext and in-memory chat state so a later
    // account cannot inherit the previous account's readable content.
    await clearCachedPlaintext().catch(() => undefined);
    clearChatCache();
    clearActiveCryptoSession();
    clearToken();
    setTokenState(null);
    setUser(null);
    router.push("/login");
  }, [router]);

  const updateUser = useCallback((u: User) => setUser(u), []);

  // BUG FOUND ON RE-AUDIT: maybeTopUpOneTimeKeys existed in lib/crypto.ts
  // but was never actually called anywhere, meaning a device's one-time
  // prekey pool would only ever shrink (each consumed when a peer starts a
  // new session with it) and never get replenished — new incoming sessions
  // would eventually have to fall back to the signed fallback key
  // indefinitely, weakening forward secrecy for those sessions over time.
  // Runs once shortly after login (offset from device registration so they
  // don't contend for the crypto lock at the same instant) and periodically
  // thereafter while the user is signed in.
  useEffect(() => {
    if (!user) return;
    const initial = setTimeout(() => {
      maybeTopUpOneTimeKeys().catch((err) => console.error("One-time key top-up failed:", err));
    }, 5_000);
    const interval = setInterval(() => {
      maybeTopUpOneTimeKeys().catch((err) => console.error("One-time key top-up failed:", err));
    }, 15 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
