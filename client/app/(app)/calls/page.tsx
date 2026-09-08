"use client";

import { useEffect, useState, useMemo } from "react";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Video, Phone as PhoneIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useCall } from "@/hooks/useCall";
import { Call } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListItemSkeleton } from "@/components/ui/Skeleton";
import { cn, formatTime, formatDuration } from "@/lib/utils";

function dateGroupOf(iso: string): "Today" | "Yesterday" | "Older" {
  const d = new Date(iso.replace(" ", "T") + "Z");
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return "Older";
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const { startCall } = useCall();

  useEffect(() => {
    api
      .get<{ calls: Call[] }>("/calls")
      .then((res) => setCalls(res.calls))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const order: ("Today" | "Yesterday" | "Older")[] = ["Today", "Yesterday", "Older"];
    const map: Record<string, Call[]> = { Today: [], Yesterday: [], Older: [] };
    for (const call of calls) {
      map[dateGroupOf(call.startedAt)].push(call);
    }
    return order.map((label) => ({ label, calls: map[label] })).filter((g) => g.calls.length > 0);
  }, [calls]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col">
      <div className="safe-top border-b border-border bg-surface p-4">
        <h1 className="text-lg font-semibold">Calls</h1>
        <p className="text-sm text-muted">Your recent audio and video calls</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col gap-1 p-2">
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
          </div>
        )}

        {!loading && calls.length === 0 && (
          <EmptyState
            icon={PhoneIcon}
            title="No calls yet"
            description="Start a call from any conversation and it'll show up here."
          />
        )}

        {!loading &&
          groups.map((group) => (
            <div key={group.label}>
              <h2 className="sticky top-0 z-[1] bg-background/95 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted backdrop-blur">
                {group.label}
              </h2>
              {group.calls.map((call) => {
                const isMissed = call.displayStatus === "missed" && call.direction === "incoming";
                const Icon =
                  call.direction === "incoming"
                    ? isMissed
                      ? PhoneMissed
                      : PhoneIncoming
                    : PhoneOutgoing;

                return (
                  <div
                    key={call.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover"
                  >
                    <Avatar
                      src={call.otherUser?.avatar}
                      name={call.otherUser?.username || "Unknown"}
                      size={44}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{call.otherUser?.username || "Unknown user"}</p>
                      <div
                        className={cn(
                          "flex items-center gap-1.5 text-xs",
                          isMissed ? "text-danger" : "text-muted"
                        )}
                      >
                        <Icon size={14} />
                        <span className="capitalize">{call.displayStatus}</span>
                        {call.duration > 0 && <span>• {formatDuration(call.duration)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{formatTime(call.startedAt)}</span>
                      {call.otherUser && (
                        <button
                          onClick={() => startCall(call.otherUser!, call.type)}
                          aria-label={`Call ${call.otherUser.username}`}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-accent-soft"
                        >
                          {call.type === "video" ? <Video size={18} /> : <PhoneIcon size={18} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
