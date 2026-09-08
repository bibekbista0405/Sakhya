"use client";

import { useMemo } from "react";
import { Bell, MessageCircle, UserPlus, UserCheck, PhoneMissed, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { useNotifications } from "@/hooks/useNotifications";
import { cn, formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListItemSkeleton } from "@/components/ui/Skeleton";
import { Notification } from "@/types";

const ICONS: Record<Notification["type"], typeof Bell> = {
  message: MessageCircle,
  friend_request: UserPlus,
  friend_accept: UserCheck,
  missed_call: PhoneMissed,
  incoming_call: PhoneIncoming,
};

function linkFor(n: Notification): string {
  if (n.type === "message" || n.type === "friend_request" || n.type === "friend_accept") return "/chats";
  if (n.type === "missed_call" || n.type === "incoming_call") return "/calls";
  return "/notifications";
}

function dateGroupOf(iso: string): "Today" | "Yesterday" | "Older" {
  const d = new Date(iso.replace(" ", "T") + "Z");
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return "Older";
}

export default function NotificationsPage() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, loading } = useNotifications();

  const groups = useMemo(() => {
    const order: ("Today" | "Yesterday" | "Older")[] = ["Today", "Yesterday", "Older"];
    const map: Record<string, Notification[]> = { Today: [], Yesterday: [], Older: [] };
    for (const n of notifications) {
      map[dateGroupOf(n.createdAt)].push(n);
    }
    return order.map((label) => ({ label, items: map[label] })).filter((g) => g.items.length > 0);
  }, [notifications]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col">
      <div className="safe-top flex items-center justify-between border-b border-border bg-surface p-4">
        <div>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-sm text-muted">Stay on top of messages, requests, and calls</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllAsRead}>
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col gap-1 p-2">
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <EmptyState icon={Bell} title="You're all caught up" description="New activity will show up here." />
        )}

        {!loading &&
          groups.map((group) => (
            <div key={group.label}>
              <h2 className="sticky top-0 z-[1] bg-background/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted backdrop-blur">
                {group.label}
              </h2>
              {group.items.map((n) => {
                const Icon = ICONS[n.type];
                return (
                  <Link
                    key={n.id}
                    href={linkFor(n)}
                    onClick={() => !n.isRead && markAsRead(n.id)}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 hover:bg-surface-hover",
                      !n.isRead && "bg-accent-soft/40"
                    )}
                  >
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{n.content}</p>
                      <p className="mt-0.5 text-xs text-muted">{formatTime(n.createdAt)}</p>
                    </div>
                    {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </Link>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
