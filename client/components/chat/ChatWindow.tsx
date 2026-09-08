"use client";

import { useEffect, useRef, useState, useCallback, useMemo, FormEvent } from "react";
import {
  Phone,
  Video,
  Send,
  ArrowLeft,
  MessageCircle,
  Smile,
  Search,
  X,
  ChevronUp,
  Reply,
  Edit3,
  ShieldCheck,
  ShieldAlert,
  Paperclip,
  Loader2,
  Timer,
  Check,
  Eye,
  Lock as LockIcon,
} from "lucide-react";
import { FastNavLink } from "@/components/layout/FastNavLink";
import { api, ApiError } from "@/lib/api";
import { getChatCache, isChatCacheFresh, setChatCache, updateCachedMessages } from "@/lib/chatCache";
import { useAuth } from "@/hooks/useAuth";
import { useSocket } from "@/hooks/useSocket";
import { useCall } from "@/hooks/useCall";
import { Message, User } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MessageBubbleSkeleton } from "@/components/ui/Skeleton";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { encryptForPeer } from "@/lib/crypto";
import { encryptAndUploadAttachment } from "@/lib/attachments";
import { resolveMessagePlaintext, resolveMessageList } from "@/lib/messageDecrypt";
import { setCachedPlaintext } from "@/lib/messageStore";
import { IdentityKeyChangedError } from "@/lib/trust";
import { SecurityVerification } from "@/components/chat/SecurityVerification";
import { ChatLockPrompt } from "@/components/chat/ChatLockPrompt";
import { useChatLock } from "@/hooks/useChatLock";
import { cn } from "@/lib/utils";

const EMOJIS = ["😀", "😂", "😍", "🥰", "😎", "😭", "😡", "👍", "❤️", "🔥", "🎉", "🙏", "👏", "✨", "💯", "🤝"];

const DISAPPEARING_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Off", seconds: 0 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

export function ChatWindow({ friendId }: { friendId: string }) {
  const { user } = useAuth();
  const { socket, onlineUserIds } = useSocket();
  const { startCall } = useCall();
  const chatLock = useChatLock();

  const cached = getChatCache(friendId);
  const [friend, setFriend] = useState<User | null>(cached?.friend ?? null);
  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [securityBlocked, setSecurityBlocked] = useState(false);
  const [securityWarning, setSecurityWarning] = useState(false);
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  const [disappearingSeconds, setDisappearingSeconds] = useState(0);
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FIFO queue of plaintexts for messages this device just sent, used to label
  // our own encrypted-message echo without needing to (and being unable to)
  // decrypt our own Olm ciphertext. See lib/messageDecrypt.ts for why.
  const pendingOutgoingRef = useRef<string[]>([]);
  // Do not decrypt live Olm messages while the initial history is still being
  // hydrated. A type-1 Olm message depends on the ratchet state created by
  // earlier type-0 messages, so racing live delivery against history loading
  // can otherwise produce "No session for this message" and lose the message.
  const historyReadyRef = useRef<Promise<void>>(Promise.resolve());

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  const loadChat = useCallback(async (background = false, signal?: AbortSignal) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const [userRes, msgRes] = await Promise.all([
        api.get<{ user: User }>(`/users/${friendId}`),
        api.get<{ messages: Message[]; hasMore: boolean; disappearingSeconds?: number }>(`/messages/${friendId}?limit=100`),
      ]);
      if (signal?.aborted) return;
      setFriend(userRes.user);
      const resolved = user ? await resolveMessageList(msgRes.messages, user.id, friendId, signal) : msgRes.messages;
      setMessages(resolved);
      if (resolved.some((m) => m.securityCodeChanged)) setSecurityWarning(true);
      setHasMore(msgRes.hasMore);
      setDisappearingSeconds(msgRes.disappearingSeconds ?? 0);
      setChatCache(friendId, userRes.user, resolved);
      setLoading(false);
      if (!background) scrollToBottom(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!background) {
        setError(err instanceof ApiError ? err.message : "Could not load conversation");
        setLoading(false);
      }
    }
  }, [friendId, scrollToBottom, user]);

  useEffect(() => {
    const controller = new AbortController();
    const hydrate = async () => {
      if (!isChatCacheFresh(friendId)) {
        await loadChat(!!cached, controller.signal);
      } else {
        setLoading(false);
        requestAnimationFrame(() => scrollToBottom(false));
      }
    };
    const ready = hydrate();
    historyReadyRef.current = ready;
    return () => controller.abort();
  }, [friendId, loadChat, scrollToBottom, cached]);

  useEffect(() => {
    if (!socket) return;

    const isMessageForChat = (msg: Message) => msg.senderId === friendId || msg.receiverId === friendId;

    const onReceive = async (msg: Message) => {
      if (!isMessageForChat(msg)) return;
      // History must establish the Olm session/rachet before a live type-1
      // message is decrypted. This also prevents duplicate decrypt attempts
      // when the same message arrives via the socket while history is loading.
      await historyReadyRef.current;
      const pendingOwnPlaintext =
        msg.senderId === user?.id && msg.isEncrypted ? pendingOutgoingRef.current.shift() : undefined;
      const resolved = user
        ? await resolveMessagePlaintext(msg, user.id, friendId, pendingOwnPlaintext)
        : msg;
      if (resolved.securityCodeChanged) setSecurityWarning(true);
      setMessages((prev) => {
        if (prev.some((m) => m.id === resolved.id)) return prev;
        const next = [...prev, resolved];
        updateCachedMessages(friendId, next);
        return next;
      });
      if (msg.senderId === friendId) socket?.emit("message_seen", { friendId });
      requestAnimationFrame(() => scrollToBottom(true));
    };

    const onMessageUpdated = async (msg: Message) => {
      if (!isMessageForChat(msg)) return;
      await historyReadyRef.current;
      const resolved = user ? await resolveMessagePlaintext(msg, user.id, friendId) : msg;
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === resolved.id ? resolved : m));
        updateCachedMessages(friendId, next);
        return next;
      });
    };

    const onSeen = (data: { by: string }) => {
      if (data.by !== friendId) return;
      setMessages((prev) => {
        const next = prev.map((m) => (m.receiverId === friendId ? { ...m, status: "seen" as const } : m));
        updateCachedMessages(friendId, next);
        return next;
      });
    };

    const onTyping = (data: { senderId: string }) => data.senderId === friendId && setIsTyping(true);
    const onStopTyping = (data: { senderId: string }) => data.senderId === friendId && setIsTyping(false);

    const onMessageExpired = (data: { id: string }) => {
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== data.id);
        updateCachedMessages(friendId, next);
        return next;
      });
    };

    const onDisappearingTimerChanged = (data: { friendId: string; seconds: number }) => {
      if (data.friendId !== friendId) return;
      setDisappearingSeconds(data.seconds);
    };

    socket.on("receive_message", onReceive);
    socket.on("message_updated", onMessageUpdated);
    socket.on("message_seen", onSeen);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);
    socket.on("message_expired", onMessageExpired);
    socket.on("disappearing_timer_changed", onDisappearingTimerChanged);
    socket.emit("message_seen", { friendId });

    return () => {
      socket.off("receive_message", onReceive);
      socket.off("message_updated", onMessageUpdated);
      socket.off("message_seen", onSeen);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
      socket.off("message_expired", onMessageExpired);
      socket.off("disappearing_timer_changed", onDisappearingTimerChanged);
    };
  }, [socket, friendId, scrollToBottom, user]);

  // Local, best-effort removal of messages whose disappearing timer has
  // elapsed, independent of the server sweep — gives an immediate feel
  // rather than waiting up to ~10s for the server to notice and broadcast
  // message_expired. The server sweep is still the authoritative enforcement
  // (see runDisappearingMessageSweep on the backend); this is purely cosmetic.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        // expiresAt comes from SQLite's datetime('now', ...), formatted as
        // "YYYY-MM-DD HH:MM:SS" (UTC, no offset) — same format as
        // createdAt, and needs the same "T"+"Z" fixup before Date parsing
        // (see lib/utils.ts formatTime for the established pattern), or a
        // browser not in UTC will parse it as local time and remove
        // messages at the wrong moment.
        const stillValid = prev.filter((m) => !m.expiresAt || new Date(m.expiresAt.replace(" ", "T") + "Z").getTime() > now);
        if (stillValid.length === prev.length) return prev;
        updateCachedMessages(friendId, stillValid);
        return stillValid;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [friendId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !messages[0]) return;
    setLoadingOlder(true);
    const container = scrollRef.current;
    const oldHeight = container?.scrollHeight ?? 0;
    try {
      const before = encodeURIComponent(messages[0].createdAt);
      const beforeId = encodeURIComponent(messages[0].id);
      const res = await api.get<{ messages: Message[]; hasMore: boolean }>(`/messages/${friendId}?limit=100&before=${before}&beforeId=${beforeId}`);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const next = [...res.messages.filter((m) => !ids.has(m.id)), ...prev];
        updateCachedMessages(friendId, next);
        return next;
      });
      setHasMore(res.hasMore);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - oldHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [friendId, hasMore, loadingOlder, messages]);

  const handleChange = useCallback((value: string) => {
    setDraft(value.slice(0, 4000));
    if (!socket) return;
    socket.emit("typing", { receiverId: friendId });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stop_typing", { receiverId: friendId }), 1200);
  }, [socket, friendId]);

  const handleSend = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || !socket || !user) return;
    setDraft("");
    setShowEmoji(false);
    socket.emit("stop_typing", { receiverId: friendId });
    inputRef.current?.focus();

    try {
      const encrypted = await encryptForPeer(friendId, content);
      if (editing) {
        // We already know this message's id, so cache the new plaintext
        // directly rather than relying on the FIFO-matching used for sends.
        await setCachedPlaintext(editing.id, content);
        socket.emit("edit_message", { messageId: editing.id, ...encrypted });
        setEditing(null);
      } else {
        pendingOutgoingRef.current.push(content);
        socket.emit("send_message", { receiverId: friendId, replyToId: replyTo?.id ?? null, ...encrypted });
        setReplyTo(null);
      }
    } catch (err) {
      if (err instanceof IdentityKeyChangedError) {
        // Don't silently send under a changed key. Restore the draft, block
        // sending, and surface the security-verification panel so the user
        // can compare the new code before deciding to proceed.
        setDraft(content);
        setSecurityBlocked(true);
        setShowSecurity(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not encrypt message");
      setDraft(content);
    }
  }, [draft, socket, editing, friendId, replyTo, user]);

  const handleAttach = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !socket) return;

    const viewOnce = viewOnceArmed;
    setViewOnceArmed(false);
    setUploadingAttachment(true);
    setError(null);
    try {
      const meta = await encryptAndUploadAttachment(file, friendId, viewOnce);
      const encrypted = await encryptForPeer(friendId, JSON.stringify(meta));
      socket.emit("send_message", {
        receiverId: friendId,
        replyToId: replyTo?.id ?? null,
        attachmentId: meta.attachmentId,
        ...encrypted,
      });
      pendingOutgoingRef.current.push(JSON.stringify(meta));
      setReplyTo(null);
    } catch (err) {
      if (err instanceof IdentityKeyChangedError) {
        setSecurityBlocked(true);
        setShowSecurity(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not send attachment");
      }
    } finally {
      setUploadingAttachment(false);
    }
  }, [socket, friendId, replyTo, viewOnceArmed]);

  const insertEmoji = useCallback((emoji: string) => {
    setDraft((prev) => `${prev}${emoji}`.slice(0, 4000));
    setShowEmoji(false);
    inputRef.current?.focus();
  }, []);

  const handleDelete = useCallback((message: Message) => {
    if (window.confirm("Delete this message?")) socket?.emit("delete_message", { messageId: message.id });
  }, [socket]);

  const handleEdit = useCallback((message: Message) => {
    setEditing(message);
    setReplyTo(null);
    setDraft(message.content);
    inputRef.current?.focus();
  }, []);

  const handleReply = useCallback((message: Message) => {
    setReplyTo(message);
    setEditing(null);
    inputRef.current?.focus();
  }, []);

  const handleReact = useCallback((message: Message, emoji: string) => {
    socket?.emit("react_message", { messageId: message.id, emoji });
  }, [socket]);

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? messages.filter((m) => !m.deletedAt && m.content.toLowerCase().includes(q)) : messages;
  }, [messages, searchQuery]);

  const online = onlineUserIds.has(friendId);
  const statusLabel = isTyping ? "typing..." : online ? "Online" : "Offline";

  const renderedMessages = useMemo(
    () => filteredMessages.map((m) => (
      <MessageBubble key={m.id} message={m} isOwn={m.senderId === user?.id} onReply={handleReply} onEdit={handleEdit} onDelete={handleDelete} onReact={handleReact} />
    )),
    [filteredMessages, user?.id, handleReply, handleEdit, handleDelete, handleReact]
  );

  if (loading) {
    return (
      <div className="flex h-full flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-surface p-3"><div className="skeleton h-10 w-10 rounded-full" /><div className="flex flex-1 flex-col gap-2"><div className="skeleton h-3.5 w-24" /><div className="skeleton h-3 w-14" /></div></div>
        <div className="flex flex-1 flex-col gap-3 overflow-hidden bg-background p-4"><MessageBubbleSkeleton align="left" /><MessageBubbleSkeleton align="right" /><MessageBubbleSkeleton align="left" /></div>
      </div>
    );
  }

  if (error || !friend) {
    return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"><p className="text-sm text-danger">{error || "This conversation is unavailable."}</p><FastNavLink href="/chats" className="text-sm text-accent hover:underline">Back to chats</FastNavLink></div>;
  }

  if (chatLock.isLocked(friendId) && !chatLock.sessionUnlocked) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background p-4">
        <ChatLockPrompt
          title={`${friend.firstName || friend.username}'s locked chat`}
          description="Enter your Chat Lock PIN to view this conversation."
          onSubmit={(pin) => chatLock.verify(pin)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 p-2.5 backdrop-blur-sm">
        <FastNavLink href="/chats" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-hover sm:hidden" aria-label="Back to chats"><ArrowLeft size={20} /></FastNavLink>
        <Avatar src={friend.avatar} name={friend.username} size={40} online={online} />
        <div className="min-w-0 flex-1"><p className="truncate font-medium leading-tight">{friend.username}</p><p className="truncate text-xs text-muted" aria-live="polite">{statusLabel}</p></div>
        <button onClick={() => setShowSearch((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Search messages"><Search size={19} /></button>
        <div className="relative">
          <button
            onClick={() => setShowDisappearingMenu((v) => !v)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-hover",
              disappearingSeconds > 0 ? "text-accent" : "text-muted hover:text-foreground"
            )}
            aria-label="Disappearing messages"
            aria-haspopup="menu"
            aria-expanded={showDisappearingMenu}
          >
            <Timer size={19} />
          </button>
          {showDisappearingMenu && (
            <div role="menu" className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
              <p className="px-2.5 py-1.5 text-xs font-medium text-muted">Disappearing messages</p>
              {DISAPPEARING_OPTIONS.map((opt) => (
                <button
                  key={opt.seconds}
                  role="menuitemradio"
                  aria-checked={disappearingSeconds === opt.seconds}
                  onClick={() => {
                    socket?.emit("set_disappearing_timer", { friendId, seconds: opt.seconds });
                    setDisappearingSeconds(opt.seconds);
                    setShowDisappearingMenu(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-hover",
                    disappearingSeconds === opt.seconds && "text-accent"
                  )}
                >
                  {opt.label}
                  {disappearingSeconds === opt.seconds && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setSecurityBlocked(false); setShowSecurity(true); }}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-hover",
            securityWarning ? "text-danger" : "text-muted hover:text-foreground"
          )}
          aria-label="Security verification"
        >
          {securityWarning ? <ShieldAlert size={19} /> : <ShieldCheck size={19} />}
        </button>
        <button onClick={() => startCall(friend, "audio")} aria-label="Start audio call" className="flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-accent-soft"><Phone size={19} /></button>
        <button onClick={() => startCall(friend, "video")} aria-label="Start video call" className="flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-accent-soft"><Video size={20} /></button>
        {chatLock.hasPin && (
          <button
            onClick={() => {
              if (chatLock.isLocked(friendId)) setShowUnlockPrompt(true);
              else chatLock.lockConversation(friendId);
            }}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-hover",
              chatLock.isLocked(friendId) ? "text-accent" : "text-muted hover:text-foreground"
            )}
            aria-label={chatLock.isLocked(friendId) ? "Unlock this chat" : "Lock this chat"}
            title={chatLock.isLocked(friendId) ? "Locked — tap to unlock" : "Lock this chat"}
          >
            <LockIcon size={19} />
          </button>
        )}
      </div>

      {showUnlockPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <ChatLockPrompt
            title="Unlock this chat"
            description="Enter your PIN to remove the lock from this conversation."
            onSubmit={async (pin) => {
              await chatLock.unlockConversation(friendId, pin);
              setShowUnlockPrompt(false);
            }}
            onCancel={() => setShowUnlockPrompt(false)}
          />
        </div>
      )}

      {securityWarning && !showSecurity && (
        <button
          onClick={() => { setSecurityBlocked(false); setShowSecurity(true); }}
          className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-3 py-2 text-left text-xs text-danger"
        >
          <ShieldAlert size={14} className="shrink-0" />
          {friend.firstName || friend.username}&apos;s security code changed. Tap to review.
        </button>
      )}

      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <Search size={16} className="text-muted" />
          <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search in conversation" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <button onClick={() => { setSearchQuery(""); setShowSearch(false); }} className="rounded-full p-2 text-muted hover:bg-surface-hover" aria-label="Close search"><X size={17} /></button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain bg-background p-3 sm:p-4">
        {hasMore && !searchQuery && (
          <div className="mb-3 flex justify-center"><button onClick={loadOlder} disabled={loadingOlder} className="flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-50"><ChevronUp size={14} />{loadingOlder ? "Loading..." : "Load older messages"}</button></div>
        )}
        {filteredMessages.length === 0 ? (
          <EmptyState icon={searchQuery ? Search : MessageCircle} title={searchQuery ? "No messages found" : `Say hello to ${friend.username}`} description={searchQuery ? "Try another word." : "Your conversation will show up here."} />
        ) : (
          <div className="flex flex-col gap-2">{renderedMessages}</div>
        )}
      </div>

      {(replyTo || editing) && (
        <div className="flex items-center gap-2 border-t border-border bg-surface px-3 py-2 text-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">{editing ? <Edit3 size={15} /> : <Reply size={15} />}</div>
          <div className="min-w-0 flex-1"><p className="text-xs font-medium text-accent">{editing ? "Editing message" : `Replying to ${replyTo?.senderId === user?.id ? "yourself" : friend.username}`}</p><p className="truncate text-xs text-muted">{editing ? editing.content : replyTo?.content}</p></div>
          <button onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }} className="rounded-full p-2 text-muted hover:bg-surface-hover" aria-label="Cancel"><X size={16} /></button>
        </div>
      )}

      <form onSubmit={handleSend} className="safe-bottom relative flex items-end gap-2 border-t border-border bg-surface p-2.5">
        {showEmoji && (
          <div className="absolute bottom-16 left-2 z-30 w-72 rounded-2xl border border-border bg-surface p-3 shadow-xl">
            <div className="grid grid-cols-8 gap-1">{EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)} className="rounded-lg p-1.5 text-xl hover:bg-surface-hover">{emoji}</button>)}</div>
          </div>
        )}
        <button type="button" onClick={() => setShowEmoji((v) => !v)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Add emoji"><Smile size={20} /></button>
        <input ref={fileInputRef} type="file" onChange={handleAttach} className="hidden" aria-hidden="true" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAttachment || !!editing}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          aria-label="Attach file"
        >
          {uploadingAttachment ? <Loader2 size={19} className="animate-spin" /> : <Paperclip size={19} />}
        </button>
        <button
          type="button"
          onClick={() => setViewOnceArmed((v) => !v)}
          disabled={uploadingAttachment || !!editing}
          title="Next attachment sent will be view-once"
          aria-pressed={viewOnceArmed}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
            viewOnceArmed ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-hover hover:text-foreground"
          )}
          aria-label="Toggle view-once for next attachment"
        >
          <Eye size={19} />
        </button>
        <textarea ref={inputRef} value={draft} onChange={(e) => handleChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} rows={1} placeholder={editing ? "Edit message" : "Type a message"} aria-label="Message" className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-[15px] leading-5 outline-none focus:ring-2 focus:ring-accent/40" />
        <Button type="submit" size="icon" disabled={!draft.trim()} aria-label={editing ? "Save message" : "Send message"}><Send size={18} /></Button>
      </form>

      {showSecurity && (
        <SecurityVerification
          friend={friend}
          blockedOnChange={securityBlocked}
          onClose={() => { setShowSecurity(false); setSecurityBlocked(false); }}
          onAcceptAndRetry={() => {
            setShowSecurity(false);
            setSecurityBlocked(false);
            setSecurityWarning(false);
            handleSend();
          }}
        />
      )}
    </div>
  );
}
