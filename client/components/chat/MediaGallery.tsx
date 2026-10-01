"use client";

import { useEffect, useState, useCallback } from "react";
import { FileText, Loader2, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Message, User } from "@/types";
import { resolveMessagePlaintext } from "@/lib/messageDecrypt";
import { parseAttachmentMetadata, downloadAndDecryptAttachment, AttachmentMetadata } from "@/lib/attachments";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

type MediaTab = "media" | "files";

interface GalleryItem {
  messageId: string;
  meta: AttachmentMetadata;
}

export function MediaGallery({ friend, selfId }: { friend: User; selfId: string }) {
  const [tab, setTab] = useState<MediaTab>("media");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const loadPage = useCallback(
    async (before: string | null) => {
      const query = before ? `?before=${encodeURIComponent(before)}&limit=30` : "?limit=30";
      const res = await api.get<{ messages: Message[]; hasMore: boolean; nextBefore: string | null }>(
        `/messages/${friend.id}/media${query}`
      );
      const resolved: GalleryItem[] = [];
      for (const m of res.messages) {
        if (m.decryptError) continue;
        const r = await resolveMessagePlaintext(m, selfId, friend.id);
        const meta = r.decryptError ? null : parseAttachmentMetadata(r.content);
        if (meta) resolved.push({ messageId: m.id, meta });
      }
      return { resolved, hasMore: res.hasMore, nextBefore: res.nextBefore };
    },
    [friend.id, selfId]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadPage(null)
      .then(({ resolved, hasMore: more, nextBefore }) => {
        setItems(resolved);
        setHasMore(more);
        setCursor(nextBefore);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load media"))
      .finally(() => setLoading(false));
  }, [loadPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { resolved, hasMore: more, nextBefore } = await loadPage(cursor);
      setItems((prev) => [...prev, ...resolved]);
      setHasMore(more);
      setCursor(nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (tab !== "media") return;
    let cancelled = false;
    (async () => {
      for (const item of items) {
        if (cancelled) return;
        if (!item.meta.mimeType.startsWith("image/") || thumbs[item.messageId]) continue;
        try {
          const url = await downloadAndDecryptAttachment(item.meta);
          if (!cancelled) setThumbs((prev) => ({ ...prev, [item.messageId]: url }));
        } catch {
          // A single failed thumbnail shouldn't block the rest of the gallery.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tab]);

  useEffect(() => {
    return () => {
      Object.values(thumbs).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mediaItems = items.filter((i) => i.meta.mimeType.startsWith("image/") || i.meta.mimeType.startsWith("video/"));
  const fileItems = items.filter((i) => !i.meta.mimeType.startsWith("image/") && !i.meta.mimeType.startsWith("video/"));
  const visible = tab === "media" ? mediaItems : fileItems;

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-lg bg-surface-hover p-1">
        <button
          onClick={() => setTab("media")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium ${tab === "media" ? "bg-surface shadow-sm" : "text-muted"}`}
        >
          Media ({mediaItems.length}{hasMore ? "+" : ""})
        </button>
        <button
          onClick={() => setTab("files")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium ${tab === "files" ? "bg-surface shadow-sm" : "text-muted"}`}
        >
          Files ({fileItems.length}{hasMore ? "+" : ""})
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}
      {error && <p className="py-4 text-center text-sm text-danger">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={tab === "media" ? ImageIcon : FileText}
          title={tab === "media" ? "No media yet" : "No files yet"}
          description={`Shared ${tab === "media" ? "photos and videos" : "files"} will show up here.`}
        />
      )}

      {tab === "media" && mediaItems.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {mediaItems.map((item) => (
            <div key={item.messageId} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-hover">
              {thumbs[item.messageId] ? (
                item.meta.mimeType.startsWith("video/") ? (
                  <video src={thumbs[item.messageId]} className="h-full w-full object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[item.messageId]} alt={item.meta.fileName} className="h-full w-full object-cover" />
                )
              ) : (
                <Loader2 size={16} className="animate-spin text-muted" />
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "files" && fileItems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {fileItems.map((item) => (
            <div key={item.messageId} className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
              <FileText size={18} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.meta.fileName}</p>
                <p className="text-xs text-muted">{(item.meta.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <Button variant="outline" className="mt-3 w-full" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  );
}
