"use client";

import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useSocket } from "@/hooks/useSocket";
import { useChatLock } from "@/hooks/useChatLock";
import { api } from "@/lib/api";
import { Notification } from "@/types";
import { showBrowserNotification } from "@/lib/browserNotifications";
import { getCachedPlaintext, deleteCachedPlaintext } from "@/lib/messageStore";
import { parseAttachmentMetadata } from "@/lib/attachments";

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const chatLock = useChatLock();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // The socket-listener effect below only re-runs when `socket` changes,
  // which is rare once connected — so anything it closes over directly
  // would freeze at whatever `chatLock`/`router` were when the socket first
  // connected (likely before the lock list even finished its first fetch).
  // Refs kept fresh on every render sidestep that stale-closure trap without
  // having to re-subscribe the socket listener on every chatLock update.
  const chatLockRef = useRef(chatLock);
  chatLockRef.current = chatLock;
  const routerRef = useRef(router);
  routerRef.current = router;

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get<{ notifications: Notification[] }>("/notifications");
      setNotifications(res.notifications);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) refresh();
    else {
      setNotifications([]);
      setLoading(true);
    }
  }, [user, refresh]);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n: Notification) => {
      setNotifications((prev) => [n, ...prev]);
      showForNotification(n).catch(() => undefined);
    };
    const onMessageExpired = (data: { id: string }) => {
      // This provider stays mounted even when no chat is open, so local
      // plaintext is purged even if the expiry event arrives in the background.
      deleteCachedPlaintext(data.id).catch(() => undefined);
    };
    socket.on("notification", onNotification);
    socket.on("message_expired", onMessageExpired);
    return () => {
      socket.off("notification", onNotification);
      socket.off("message_expired", onMessageExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  /**
   * Renders the OS-level notification for an incoming event. For a message
   * notification the server had to degrade to sender-only text (encrypted
   * content, but the user's preference is "full"), and if this device
   * already decrypted that exact message (e.g. it arrived while another tab
   * had the chat open), use the real plaintext instead of the generic text
   * — the client legitimately has it; the server never did. A conversation
   * the user has locked is never upgraded this way, even if the server
   * would have allowed it, as a client-side defense in depth on top of the
   * server's own floor-to-"generic" behavior for locked chats.
   */
  async function showForNotification(n: Notification) {
    if (n.type !== "message") {
      showBrowserNotification(n.content, { tag: n.id });
      return;
    }

    let body = n.content;
    if (n.upgradableToFull && n.relatedId && n.senderId && !chatLockRef.current.isLocked(n.senderId)) {
      const cached = await getCachedPlaintext(n.relatedId);
      if (cached !== undefined) {
        const attachment = parseAttachmentMetadata(cached);
        body = attachment ? `Sent ${attachment.viewOnce ? "a view-once " : "an "}attachment` : cached;
      }
    }

    showBrowserNotification("Sakhya", {
      body,
      tag: n.senderId ? `chat-${n.senderId}` : n.id, // collapses multiple messages from the same sender into one notification
      onClick: () => {
        if (n.senderId) routerRef.current.push(`/chats/${n.senderId}`);
      },
    });
  }

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: 1 } : n)));
    try {
      await api.put(`/notifications/${id}/read`);
    } catch {
      // ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })));
    try {
      await api.put("/notifications/read-all");
    } catch {
      // ignore
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
