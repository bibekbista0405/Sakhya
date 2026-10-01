"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  ShieldCheck,
  Timer,
  BellOff,
  Bell,
  Lock,
  Star,
  Link2,
  UserX,
  Flag,
  Trash2,
  ChevronRight,
  Check,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api";
import { User, Message } from "@/types";
import { cn, formatDay } from "@/lib/utils";
import { useChatLock } from "@/hooks/useChatLock";
import { extractLinks } from "@/lib/linkExtraction";
import { MediaGallery } from "@/components/chat/MediaGallery";
import { ChatLockPrompt } from "@/components/chat/ChatLockPrompt";

const DISAPPEARING_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Off", seconds: 0 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "impersonation", label: "Impersonation" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

interface Props {
  friend: User;
  selfId: string;
  messages: Message[];
  disappearingSeconds: number;
  socket: Socket | null;
  onClose: () => void;
  onOpenSecurity: () => void;
  onCleared: () => void;
}

type Tab = "info" | "media" | "links";

export function ChatInfo({ friend, selfId, messages, disappearingSeconds, socket, onClose, onOpenSecurity, onCleared }: Props) {
  const chatLock = useChatLock();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("info");
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [clearing, setClearing] = useState<"chat" | "conversation" | null>(null);
  const [confirmClear, setConfirmClear] = useState<"chat" | "conversation" | null>(null);

  useEffect(() => {
    api
      .get<{ isMuted: boolean }>(`/messages/${friend.id}`)
      .then((res) => setIsMuted(!!res.isMuted))
      .catch(() => undefined);
    api
      .get<{ blocked: User[] }>("/friends/blocked")
      .then((res) => setIsBlocked(res.blocked.some((u) => u.id === friend.id)))
      .catch(() => undefined);
  }, [friend.id]);

  useEffect(() => {
    if (!socket) return;
    const onMuted = (data: { friendId: string; muted: boolean }) => {
      if (data.friendId === friend.id) setIsMuted(data.muted);
    };
    socket.on("conversation_muted", onMuted);
    return () => {
      socket.off("conversation_muted", onMuted);
    };
  }, [socket, friend.id]);

  const links = extractLinks(messages);
  const starredCount = messages.filter((m) => m.isStarred).length;
  const locked = chatLock.isLocked(friend.id);

  const lastSeenLabel = friend.online
    ? "Online"
    : friend.lastSeenAt
    ? `Last seen ${formatDay(friend.lastSeenAt)}`
    : "Offline";

  async function toggleBlock() {
    setBlockLoading(true);
    try {
      await api.post(`/friends/${isBlocked ? "unblock" : "block"}/${friend.id}`, {});
      setIsBlocked((v) => !v);
    } catch {
      // surfaced implicitly by the button staying in its prior state
    } finally {
      setBlockLoading(false);
    }
  }

  async function submitReport(reason: string) {
    setReportError(null);
    try {
      await api.post(`/users/${friend.id}/report`, { reason });
      setReportSent(true);
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : "Could not submit report");
    }
  }

  async function handleClear(mode: "chat" | "conversation") {
    setClearing(mode);
    try {
      await api.post(`/messages/${friend.id}/clear`, {});
      onCleared();
      setConfirmClear(null);
      if (mode === "conversation") {
        onClose();
        router.push("/chats");
      }
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-sm flex-col overflow-y-auto bg-surface shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 p-4 backdrop-blur-sm">
          <h2 className="font-semibold">Chat info</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2 border-b border-border p-6 text-center">
          <Avatar src={friend.avatar} name={friend.username} size={72} online={friend.online} />
          <p className="text-lg font-semibold">{friend.username}</p>
          {(friend.firstName || friend.lastName) && (
            <p className="text-sm text-muted">{[friend.firstName, friend.lastName].filter(Boolean).join(" ")}</p>
          )}
          <p className="text-xs text-muted">{lastSeenLabel}</p>
          {friend.bio && <p className="mt-1 max-w-xs text-sm text-muted">{friend.bio}</p>}
        </div>

        <div className="flex border-b border-border">
          {(["info", "media", "links"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-sm font-medium capitalize",
                tab === t ? "border-accent text-accent" : "border-transparent text-muted"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "info" && (
          <div className="flex flex-col gap-1 p-4">
            <button
              onClick={onOpenSecurity}
              className="flex items-center justify-between rounded-xl px-2 py-3 text-left hover:bg-surface-hover"
            >
              <span className="flex items-center gap-3">
                <ShieldCheck size={18} className="text-muted" />
                <span className="text-sm font-medium">Encryption & verification</span>
              </span>
              <ChevronRight size={16} className="text-muted" />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowDisappearingMenu((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-left hover:bg-surface-hover"
              >
                <span className="flex items-center gap-3">
                  <Timer size={18} className="text-muted" />
                  <span className="text-sm font-medium">Disappearing messages</span>
                </span>
                <span className="text-xs text-muted">
                  {DISAPPEARING_OPTIONS.find((o) => o.seconds === disappearingSeconds)?.label ?? "Off"}
                </span>
              </button>
              {showDisappearingMenu && (
                <div className="mt-1 rounded-xl border border-border bg-background p-1.5">
                  {DISAPPEARING_OPTIONS.map((opt) => (
                    <button
                      key={opt.seconds}
                      onClick={() => {
                        socket?.emit("set_disappearing_timer", { friendId: friend.id, seconds: opt.seconds });
                        setShowDisappearingMenu(false);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-hover"
                    >
                      {opt.label}
                      {disappearingSeconds === opt.seconds && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => socket?.emit(isMuted ? "unmute_conversation" : "mute_conversation", { friendId: friend.id })}
              className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-left hover:bg-surface-hover"
            >
              <span className="flex items-center gap-3">
                {isMuted ? <BellOff size={18} className="text-muted" /> : <Bell size={18} className="text-muted" />}
                <span className="text-sm font-medium">Mute notifications</span>
              </span>
              <div className={cn("h-5 w-9 rounded-full p-0.5 transition-colors", isMuted ? "bg-accent" : "bg-surface-hover")}>
                <div className={cn("h-4 w-4 rounded-full bg-white transition-transform", isMuted && "translate-x-4")} />
              </div>
            </button>

            <button
              onClick={() => (locked ? setShowUnlockPrompt(true) : chatLock.lockConversation(friend.id))}
              disabled={!chatLock.hasPin}
              className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-left hover:bg-surface-hover disabled:opacity-50"
            >
              <span className="flex items-center gap-3">
                <Lock size={18} className="text-muted" />
                <span className="text-sm font-medium">Chat lock</span>
              </span>
              <span className="text-xs text-muted">
                {!chatLock.hasPin ? "Set a PIN in Settings" : locked ? "Locked" : "Off"}
              </span>
            </button>

            <a
              href="/starred"
              className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-left hover:bg-surface-hover"
            >
              <span className="flex items-center gap-3">
                <Star size={18} className="text-muted" />
                <span className="text-sm font-medium">Starred messages</span>
              </span>
              <span className="text-xs text-muted">{starredCount} in view</span>
            </a>

            <div className="my-2 border-t border-border" />

            <button
              onClick={toggleBlock}
              disabled={blockLoading}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              <UserX size={18} />
              <span className="text-sm font-medium">{isBlocked ? "Unblock" : `Block ${friend.username}`}</span>
            </button>

            <button
              onClick={() => { setShowReport(true); setReportSent(false); setReportError(null); }}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-danger hover:bg-danger-soft"
            >
              <Flag size={18} />
              <span className="text-sm font-medium">Report {friend.username}</span>
            </button>

            <button
              onClick={() => setConfirmClear("chat")}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-danger hover:bg-danger-soft"
            >
              <Trash2 size={18} />
              <span className="text-sm font-medium">Clear chat</span>
            </button>

            <button
              onClick={() => setConfirmClear("conversation")}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-danger hover:bg-danger-soft"
            >
              <Trash2 size={18} />
              <span className="text-sm font-medium">Delete conversation</span>
            </button>
            <p className="px-2 pt-1 text-[11px] leading-4 text-muted">
              Clearing or deleting only affects your own view — {friend.username} keeps their copy of the conversation.
            </p>
          </div>
        )}

        {tab === "media" && (
          <div className="p-4">
            <MediaGallery friend={friend} selfId={selfId} />
          </div>
        )}

        {tab === "links" && (
          <div className="flex flex-col gap-2 p-4">
            <p className="text-[11px] leading-4 text-muted">
              Only reflects links from messages already loaded in this conversation, not full history.
            </p>
            {links.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No links shared yet.</p>
            ) : (
              links.map((l, i) => (
                <a
                  key={`${l.messageId}-${i}`}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-lg border border-border p-2.5 hover:bg-surface-hover"
                >
                  <Link2 size={16} className="shrink-0 text-muted" />
                  <span className="truncate text-sm text-accent">{l.url}</span>
                </a>
              ))
            )}
          </div>
        )}
      </div>

      {showUnlockPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <ChatLockPrompt
            title="Unlock this chat"
            description="Enter your PIN to remove the lock from this conversation."
            onSubmit={async (pin) => {
              await chatLock.unlockConversation(friend.id, pin);
              setShowUnlockPrompt(false);
            }}
            onCancel={() => setShowUnlockPrompt(false)}
          />
        </div>
      )}

      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-border bg-surface p-5">
            {reportSent ? (
              <>
                <p className="mb-3 text-sm font-medium">Report submitted.</p>
                <Button className="w-full" onClick={() => setShowReport(false)}>Close</Button>
              </>
            ) : (
              <>
                <p className="mb-3 font-medium">Report {friend.username}</p>
                {reportError && <p className="mb-2 text-sm text-danger">{reportError}</p>}
                <div className="flex flex-col gap-1.5">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => submitReport(r.value)}
                      className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-hover"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Button variant="outline" className="mt-3 w-full" onClick={() => setShowReport(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="mb-2 font-medium">
              {confirmClear === "chat" ? "Clear this chat?" : "Delete this conversation?"}
            </p>
            <p className="mb-4 text-sm text-muted">
              This removes {confirmClear === "chat" ? "all messages" : "the conversation"} from your own view only.
              {friend.username} keeps their copy.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" disabled={!!clearing} onClick={() => handleClear(confirmClear)}>
                {clearing ? "Working..." : "Confirm"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setConfirmClear(null)} disabled={!!clearing}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
