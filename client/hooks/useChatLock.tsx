"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface ChatLockStatus {
  hasPin: boolean;
  lockedFriendIds: string[];
}

interface ChatLockContextValue {
  hasPin: boolean;
  lockedFriendIds: string[];
  /**
   * Whether the correct PIN has been entered THIS SESSION. Deliberately
   * in-memory only (not persisted to localStorage/sessionStorage) — closing
   * the tab or reloading always re-locks, which is the point of the feature.
   */
  sessionUnlocked: boolean;
  isLocked: (friendId: string) => boolean;
  refresh: () => Promise<void>;
  verify: (pin: string) => Promise<boolean>;
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  removePin: (pin: string) => Promise<void>;
  lockConversation: (friendId: string) => Promise<void>;
  unlockConversation: (friendId: string, pin: string) => Promise<void>;
  /** Re-locks everything for the rest of this session without touching the PIN or per-chat lock state. */
  relock: () => void;
}

const ChatLockContext = createContext<ChatLockContextValue | undefined>(undefined);

export function ChatLockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hasPin, setHasPin] = useState(false);
  const [lockedFriendIds, setLockedFriendIds] = useState<string[]>([]);
  const [sessionUnlocked, setSessionUnlocked] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get<ChatLockStatus>("/chat-lock/status");
      setHasPin(res.hasPin);
      setLockedFriendIds(res.lockedFriendIds);
    } catch {
      // non-fatal: chat lock state just won't be available this load
    }
  }, [user]);

  useEffect(() => {
    if (user) refresh();
    else {
      setHasPin(false);
      setLockedFriendIds([]);
      setSessionUnlocked(false);
    }
  }, [user, refresh]);

  const isLocked = useCallback((friendId: string) => lockedFriendIds.includes(friendId), [lockedFriendIds]);

  const verify = useCallback(async (pin: string) => {
    const res = await api.post<{ valid: boolean }>("/chat-lock/verify", { pin });
    if (res.valid) setSessionUnlocked(true);
    return res.valid;
  }, []);

  const setPin = useCallback(
    async (pin: string, currentPin?: string) => {
      await api.post("/chat-lock/pin", { pin, currentPin });
      await refresh();
    },
    [refresh]
  );

  const removePin = useCallback(
    async (pin: string) => {
      await api.delete("/chat-lock/pin", { pin });
      setSessionUnlocked(false);
      await refresh();
    },
    [refresh]
  );

  const lockConversation = useCallback(
    async (friendId: string) => {
      await api.post(`/chat-lock/lock/${friendId}`, {});
      await refresh();
    },
    [refresh]
  );

  const unlockConversation = useCallback(
    async (friendId: string, pin: string) => {
      await api.post(`/chat-lock/unlock/${friendId}`, { pin });
      await refresh();
    },
    [refresh]
  );

  const relock = useCallback(() => setSessionUnlocked(false), []);

  return (
    <ChatLockContext.Provider
      value={{
        hasPin,
        lockedFriendIds,
        sessionUnlocked,
        isLocked,
        refresh,
        verify,
        setPin,
        removePin,
        lockConversation,
        unlockConversation,
        relock,
      }}
    >
      {children}
    </ChatLockContext.Provider>
  );
}

export function useChatLock(): ChatLockContextValue {
  const ctx = useContext(ChatLockContext);
  if (!ctx) throw new Error("useChatLock must be used within a ChatLockProvider");
  return ctx;
}
