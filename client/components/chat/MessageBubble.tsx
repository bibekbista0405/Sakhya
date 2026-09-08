"use client";

import { memo, useMemo, useState, useEffect } from "react";
import { Check, CheckCheck, Copy, Edit3, MoreHorizontal, Reply, Trash2, Lock, ShieldAlert, FileText, Download, Loader2, Timer } from "lucide-react";
import { Message } from "@/types";
import { cn, formatTime } from "@/lib/utils";
import { parseAttachmentMetadata, downloadAndDecryptAttachment, consumeViewOnceAttachment, toConsumedMetadata, AttachmentMetadata } from "@/lib/attachments";
import { setCachedPlaintext } from "@/lib/messageStore";
import { Eye, EyeOff } from "lucide-react";

function AttachmentBubble({
  meta,
  isOwn,
  messageId,
}: {
  meta: AttachmentMetadata;
  isOwn: boolean;
  messageId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const isImage = meta.mimeType.startsWith("image/");
  const isVideo = meta.mimeType.startsWith("video/");
  const isAudio = meta.mimeType.startsWith("audio/");
  const previewable = isImage || isVideo || isAudio;

  // Auto-decrypt previewable media so it renders inline; other file types
  // stay a tap-to-download row so we don't silently fetch/decrypt large
  // documents the user may not want yet. View-once media is the exception —
  // it stays hidden behind an explicit tap regardless of type, since
  // "viewing" it is the action that triggers irreversible consumption.
  useEffect(() => {
    if (!previewable || meta.viewOnce) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    downloadAndDecryptAttachment(meta)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load attachment"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.attachmentId]);

  // View-once media that's already been viewed: nothing left to show or fetch.
  if (meta.viewOnce && meta.consumed) {
    return (
      <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", isOwn ? "border-white/30 text-white/70" : "border-border text-muted")}>
        <EyeOff size={16} className="shrink-0" />
        <span>{isOwn ? "Opened" : "Media already viewed"}</span>
      </div>
    );
  }

  const handleReveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const u = await downloadAndDecryptAttachment(meta);
      setUrl(u);
      setRevealed(true);
      // Only the recipient consumes it; the sender's own bubble never calls
      // download for a view-once attachment they sent (see ChatWindow — the
      // sender's copy comes from its own locally-known plaintext, not a
      // decrypt), so this path only ever runs for the recipient.
      await consumeViewOnceAttachment(meta.attachmentId!);
      await setCachedPlaintext(messageId, JSON.stringify(toConsumedMetadata(meta)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open attachment");
    } finally {
      setLoading(false);
    }
  };

  if (meta.viewOnce && !isOwn) {
    if (revealed && url) {
      return isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={meta.fileName} className="max-h-72 w-full rounded-lg object-cover" />
      ) : isVideo ? (
        <video src={url} controls autoPlay className="max-h-72 w-full rounded-lg" />
      ) : (
        <audio src={url} controls autoPlay className="w-full" />
      );
    }
    return (
      <button
        type="button"
        onClick={handleReveal}
        disabled={loading}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border px-3 py-3 text-left",
          isOwn ? "border-white/30 hover:bg-white/10" : "border-border hover:bg-surface-hover"
        )}
      >
        {loading ? <Loader2 size={18} className="shrink-0 animate-spin" /> : <Eye size={18} className="shrink-0" />}
        <span className="text-sm font-medium">Tap to view once</span>
      </button>
    );
  }

  if (meta.viewOnce && isOwn) {
    return (
      <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", "border-white/30 text-white/80")}>
        <Eye size={16} className="shrink-0" />
        <span>View-once {isImage ? "photo" : isVideo ? "video" : "media"} sent</span>
      </div>
    );
  }

  const handleDownloadFile = async () => {
    setLoading(true);
    setError(null);
    try {
      const u = await downloadAndDecryptAttachment(meta);
      const a = document.createElement("a");
      a.href = u;
      a.download = meta.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download attachment");
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }

  if (isImage) {
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={meta.fileName} className="max-h-72 w-full rounded-lg object-cover" />
    ) : (
      <div className="flex h-40 w-full items-center justify-center rounded-lg bg-black/10"><Loader2 size={20} className="animate-spin" /></div>
    );
  }
  if (isVideo) {
    return url ? (
      <video src={url} controls className="max-h-72 w-full rounded-lg" />
    ) : (
      <div className="flex h-40 w-full items-center justify-center rounded-lg bg-black/10"><Loader2 size={20} className="animate-spin" /></div>
    );
  }
  if (isAudio) {
    return url ? <audio src={url} controls className="w-full" /> : <Loader2 size={16} className="animate-spin" />;
  }

  return (
    <button
      type="button"
      onClick={handleDownloadFile}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left",
        isOwn ? "border-white/30 hover:bg-white/10" : "border-border hover:bg-surface-hover"
      )}
    >
      <FileText size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{meta.fileName}</p>
        <p className={cn("text-xs", isOwn ? "text-white/70" : "text-muted")}>{(meta.size / 1024).toFixed(0)} KB</p>
      </div>
      {loading ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <Download size={16} className="shrink-0" />}
    </button>
  );
}

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"];

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: MessageBubbleProps) {
  const [open, setOpen] = useState(false);
  const deleted = !!message.deletedAt;
  const reactions = useMemo(() => Object.entries(message.reactions || {}), [message.reactions]);
  const attachment = useMemo(
    () => (deleted || message.decryptError ? null : parseAttachmentMetadata(message.content)),
    [message.content, deleted, message.decryptError]
  );

  const copyMessage = async () => {
    if (deleted || message.decryptError || attachment) return;
    await navigator.clipboard?.writeText(message.content);
    setOpen(false);
  };

  return (
    <div className={cn("group flex", isOwn ? "justify-end" : "justify-start")}>
      <div className="relative max-w-[82%] sm:max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm shadow-sm",
            isOwn
              ? "rounded-br-md bg-accent text-white"
              : "rounded-bl-md border border-border bg-surface text-foreground"
          )}
        >
          {message.replyToId && !deleted && (
            <div className={cn("mb-2 rounded-xl border-l-2 px-2 py-1 text-xs", isOwn ? "border-white/60 bg-white/10 text-white/80" : "border-accent bg-accent-soft text-muted")}>
              <span className="font-medium">Reply</span>
              <p className="mt-0.5 truncate">{message.replyToContent || "Original message"}</p>
            </div>
          )}
          <p className={cn("whitespace-pre-wrap break-words", deleted && "italic text-muted", attachment && "hidden")}>
            {deleted
              ? "Message deleted"
              : message.decryptError
              ? "Unable to decrypt this message on this device"
              : message.content}
          </p>
          {attachment && !deleted && <AttachmentBubble meta={attachment} isOwn={isOwn} messageId={message.id} />}
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[11px]", isOwn ? "text-white/70" : "text-muted")}>
            {!deleted && message.isEncrypted && !message.decryptError && (
              <span title="End-to-end encrypted"><Lock size={11} /></span>
            )}
            {!deleted && !message.isEncrypted && (
              <span title="This message was not sent with end-to-end encryption"><ShieldAlert size={11} /></span>
            )}
            {!deleted && message.expiresAt && (
              <span title="This message will disappear"><Timer size={11} /></span>
            )}
            <span>{formatTime(message.createdAt)}</span>
            {message.editedAt && !deleted && <span>edited</span>}
            {isOwn && (
              <span>
                {message.status === "seen" ? <CheckCheck size={14} className="text-white" /> : message.status === "delivered" ? <CheckCheck size={14} /> : <Check size={14} />}
              </span>
            )}
          </div>
        </div>

        {reactions.length > 0 && !deleted && (
          <div className={cn("absolute -bottom-3 flex gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs shadow-sm", isOwn ? "right-2" : "left-2")}>
            {reactions.map(([emoji, users]) => (
              <button key={emoji} onClick={() => onReact(message, emoji)} className="px-0.5" aria-label={`React with ${emoji}`}>
                {emoji} {users.length}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          className={cn("absolute -top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm sm:hidden", isOwn ? "right-0" : "left-0")}
          aria-label="Message actions"
        >
          <MoreHorizontal size={14} />
        </button>

        <div className={cn("absolute -top-10 z-20 hidden items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-md group-hover:flex", isOwn ? "right-0" : "left-0")}>
          <button onClick={() => onReply(message)} className="rounded-full p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Reply"><Reply size={15} /></button>
          {!deleted && <button onClick={copyMessage} className="rounded-full p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Copy"><Copy size={15} /></button>}
          {!deleted && <button onClick={() => onReact(message, "👍")} className="rounded-full p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Like"><span className="text-sm">👍</span></button>}
          {isOwn && !deleted && <button onClick={() => onEdit(message)} className="rounded-full p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Edit"><Edit3 size={15} /></button>}
          {isOwn && !deleted && <button onClick={() => onDelete(message)} className="rounded-full p-2 text-muted hover:bg-danger-soft hover:text-danger" aria-label="Delete"><Trash2 size={15} /></button>}
          <button onClick={() => setOpen((v) => !v)} className="rounded-full p-2 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="More actions"><MoreHorizontal size={15} /></button>
        </div>

        {open && !deleted && (
          <div className={cn("absolute top-10 z-30 w-48 rounded-xl border border-border bg-surface p-2 shadow-lg", isOwn ? "right-0" : "left-0")}>
            <p className="px-2 pb-1 text-[11px] font-medium text-muted">React</p>
            <div className="grid grid-cols-4 gap-1">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => { onReact(message, emoji); setOpen(false); }} className="rounded-lg p-2 text-lg hover:bg-surface-hover" aria-label={`React with ${emoji}`}>{emoji}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
