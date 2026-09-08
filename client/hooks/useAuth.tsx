"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, clearToken, getStoredToken } from "@/lib/api";
import { User } from "@/types";
import { ensureDeviceRegistered } from "@/lib/crypto";

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
        // Finish E2EE device registration before leaving the auth-loading state.
        // This prevents the first chat screen from racing /devices/register.
        try {
          await ensureDeviceRegistered(res.user.id);
        } catch (err) {
          console.error("Device registration failed:", err);
        }
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
      await ensureDeviceRegistered(res.user.id);
      router.push("/chats");
    },
    [router]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const res = await api.post<{ user: User; token: string }>("/auth/register", payload);
      setToken(res.token, true);
      setTokenState(res.token);
      setUser(res.user);
      await ensureDeviceRegistered(res.user.id);
      router.push("/chats");
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore network errors on logout
    }
    clearToken();
    setTokenState(null);
    setUser(null);
    router.push("/login");
  }, [router]);

  const updateUser = useCallback((u: User) => setUser(u), []);

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
