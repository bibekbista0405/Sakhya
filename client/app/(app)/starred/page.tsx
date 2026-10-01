"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { resolveMessagePlaintext } from "@/lib/messageDecrypt";
import { parseAttachmentMetadata } from "@/lib/attachments";
import { cn, formatDay } from "@/lib/utils";
import { Message } from "@/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListItemSkeleton } from "@/components/ui/Skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function StarredMessagesPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<(Message & { starredAt: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ messages: (Message & { starredAt: string })[] }>("/messages/starred");
        // Each starred message may be from a different conversation, so the
        // "peer" for decryption purposes differs per message — unlike
        // ChatWindow, which only ever decrypts against one fixed friendId.
        // Resolved sequentially (not Promise.all) for the same reason
        // ChatWindow does: Olm ratchet decryption is order-sensitive per
        // session, and interleaving concurrent decrypts across conversations
        // that happen to share a session state could race.
        const resolved: (Message & { starredAt: string })[] = [];
        for (const m of res.messages) {
          if (cancelled) return;
          const peerId = m.senderId === user.id ? m.receiverId : m.senderId;
          const r = await resolveMessagePlaintext(m, user.id, peerId);
          resolved.push({ ...m, ...r });
        }
        if (!cancelled) setMessages(resolved);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load starred messages");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 pb-10 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Star size={18} className="fill-current text-accent" />
        <h1 className="text-lg font-semibold">Starred messages</h1>
      </div>
      <ErrorBanner message={error} />

      {messages === null && !error && (
        <div className="flex flex-col gap-2">
          <ListItemSkeleton />
          <ListItemSkeleton />
          <ListItemSkeleton />
        </div>
      )}

      {messages !== null && messages.length === 0 && (
        <EmptyState
          icon={Star}
          title="No starred messages"
          description="Star important messages from any conversation to find them here."
        />
      )}

      {messages !== null && messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {messages.map((m) => {
            const peerId = m.senderId === user?.id ? m.receiverId : m.senderId;
            const isOwn = m.senderId === user?.id;
            const attachment = m.decryptError ? null : parseAttachmentMetadata(m.content);
            return (
              <Link
                key={m.id}
                href={`/chats/${peerId}`}
                className="block rounded-xl border border-border bg-surface p-3.5 hover:bg-surface-hover"
              >
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span>{isOwn ? "You" : "Them"}</span>
                  <span>{formatDay(m.starredAt)}</span>
                </div>
                <p className={cn("truncate text-sm", m.decryptError && "italic text-muted")}>
                  {m.decryptError
                    ? "Unable to decrypt this message on this device"
                    : attachment
                    ? `📎 ${attachment.fileName}`
                    : m.content}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
