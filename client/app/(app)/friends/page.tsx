"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Check, X, Clock, MessageCircle, ShieldOff, ShieldCheck, UserX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSocket } from "@/hooks/useSocket";
import { User, FriendRequest } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListItemSkeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

type Tab = "friends" | "requests" | "blocked";

let friendsPageCache: {
  friends: User[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: User[];
  updatedAt: number;
} | null = null;

const FRIENDS_CACHE_TTL = 30_000;

export default function FriendsPage() {
  const { socket, onlineUserIds } = useSocket();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return t === "requests" || t === "blocked" ? t : "friends";
  });
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const [friends, setFriends] = useState<User[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [blocked, setBlocked] = useState<User[]>([]);
  const [loading, setLoading] = useState(!friendsPageCache);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [f, r, b] = await Promise.all([
        api.get<{ friends: User[] }>("/friends"),
        api.get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/friends/requests"),
        api.get<{ blocked: User[] }>("/friends/blocked"),
      ]);
      setFriends(f.friends);
      setIncoming(r.incoming);
      setOutgoing(r.outgoing);
      setBlocked(b.blocked);
      friendsPageCache = {
        friends: f.friends,
        incoming: r.incoming,
        outgoing: r.outgoing,
        blocked: b.blocked,
        updatedAt: Date.now(),
      };
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load friends");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (friendsPageCache && Date.now() - friendsPageCache.updatedAt < FRIENDS_CACHE_TTL) {
      setFriends(friendsPageCache.friends);
      setIncoming(friendsPageCache.incoming);
      setOutgoing(friendsPageCache.outgoing);
      setBlocked(friendsPageCache.blocked);
      setLoading(false);
      // Refresh quietly so the cached page feels instant without becoming stale.
      void loadAll();
      return;
    }
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadAll();
    socket.on("friend_request", refresh);
    socket.on("friend_accept", refresh);
    return () => {
      socket.off("friend_request", refresh);
      socket.off("friend_accept", refresh);
    };
  }, [socket, loadAll]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await api.get<{ users: User[] }>(`/users/search?q=${encodeURIComponent(q)}`);
        setSearchResults(res.users);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const outgoingIds = useMemo(() => new Set(outgoing.map((r) => r.receiverId)), [outgoing]);

  async function sendRequest(userId: string) {
    try {
      await api.post(`/friends/request/${userId}`);
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send request");
    }
  }

  async function acceptRequest(requestId: string) {
    await api.post(`/friends/accept/${requestId}`);
    loadAll();
  }

  async function rejectRequest(requestId: string) {
    await api.post(`/friends/reject/${requestId}`);
    loadAll();
  }

  async function removeFriend(userId: string) {
    await api.delete(`/friends/${userId}`);
    loadAll();
  }

  async function blockUser(userId: string) {
    await api.post(`/friends/block/${userId}`);
    loadAll();
  }

  async function unblockUser(userId: string) {
    await api.post(`/friends/unblock/${userId}`);
    loadAll();
  }

  const onlineCount = friends.filter((f) => onlineUserIds.has(f.id)).length;
  const pendingCount = incoming.length;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col">
      <div className="border-b border-border bg-surface p-4">
        <h1 className="text-lg font-semibold">Friends</h1>
        <p className="text-sm text-muted">
          {friends.length} friends{onlineCount > 0 ? ` · ${onlineCount} online` : ""}
        </p>
        <div className="relative mt-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username to add a friend"
            className="pl-9"
          />
        </div>
      </div>

      {query.trim() ? (
        <div className="flex-1 overflow-y-auto p-2">
          {searching && (
            <div className="flex flex-col gap-1 p-2">
              <ListItemSkeleton />
              <ListItemSkeleton />
            </div>
          )}
          {!searching && searchResults.length === 0 && (
            <EmptyState icon={Search} title="No users found" description="Try a different username." />
          )}
          {!searching &&
            searchResults.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-surface-hover">
                <Avatar src={u.avatar} name={u.username} size={40} online={u.online} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.username}</p>
                  {(u.firstName || u.lastName) && (
                    <p className="truncate text-xs text-muted">
                      {u.firstName} {u.lastName}
                    </p>
                  )}
                </div>
                {outgoingIds.has(u.id) ? (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Clock size={14} /> Pending
                  </span>
                ) : (
                  <Button size="sm" onClick={() => sendRequest(u.id)}>
                    Add
                  </Button>
                )}
              </div>
            ))}
        </div>
      ) : (
        <>
          <div className="flex border-b border-border bg-surface px-2">
            {(["friends", "requests", "blocked"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative flex-1 py-3 text-sm font-medium capitalize transition-colors",
                  tab === t ? "text-accent" : "text-muted hover:text-foreground"
                )}
              >
                {t}
                {t === "requests" && pendingCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {pendingCount}
                  </span>
                )}
                {tab === t && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {error && <p className="p-2 text-sm text-danger">{error}</p>}

            {loading && (
              <div className="flex flex-col gap-1 p-2">
                <ListItemSkeleton />
                <ListItemSkeleton />
                <ListItemSkeleton />
              </div>
            )}

            {!loading && tab === "friends" && friends.length === 0 && (
              <EmptyState
                icon={UserX}
                title="No friends yet"
                description="Search a username above to send your first friend request."
              />
            )}
            {!loading &&
              tab === "friends" &&
              friends.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-surface-hover">
                  <Avatar src={f.avatar} name={f.username} size={44} online={onlineUserIds.has(f.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.username}</p>
                    <p className="truncate text-xs text-muted">
                      {onlineUserIds.has(f.id) ? "Online" : "Offline"}
                    </p>
                  </div>
                  <Link
                    href={`/chats/${f.id}`}
                    aria-label={`Message ${f.username}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-accent-soft"
                  >
                    <MessageCircle size={18} />
                  </Link>
                  <button
                    onClick={() => blockUser(f.id)}
                    aria-label={`Block ${f.username}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <ShieldOff size={17} />
                  </button>
                  <button
                    onClick={() => removeFriend(f.id)}
                    aria-label={`Remove ${f.username}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}

            {!loading && tab === "requests" && incoming.length === 0 && outgoing.length === 0 && (
              <EmptyState icon={Clock} title="No pending requests" description="You're all caught up." />
            )}
            {!loading && tab === "requests" && (
              <div className="flex flex-col gap-4">
                {incoming.length > 0 && (
                  <div>
                    <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Incoming
                    </h3>
                    {incoming.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-surface-hover">
                        <Avatar src={r.avatar} name={r.username} size={40} />
                        <span className="flex-1 truncate text-sm font-medium">{r.username}</span>
                        <button
                          onClick={() => acceptRequest(r.id)}
                          aria-label={`Accept ${r.username}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-success-soft text-success hover:opacity-80"
                        >
                          <Check size={17} />
                        </button>
                        <button
                          onClick={() => rejectRequest(r.id)}
                          aria-label={`Reject ${r.username}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-soft text-danger hover:opacity-80"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {outgoing.length > 0 && (
                  <div>
                    <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Sent
                    </h3>
                    {outgoing.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-lg p-2.5">
                        <Avatar src={r.avatar} name={r.username} size={40} />
                        <span className="flex-1 truncate text-sm font-medium">{r.username}</span>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <Clock size={14} /> Pending
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!loading && tab === "blocked" && blocked.length === 0 && (
              <EmptyState
                icon={ShieldCheck}
                title="No blocked users"
                description="People you block won't be able to message or call you."
              />
            )}
            {!loading &&
              tab === "blocked" &&
              blocked.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-surface-hover">
                  <Avatar src={u.avatar} name={u.username} size={40} />
                  <span className="flex-1 truncate text-sm font-medium">{u.username}</span>
                  <Button size="sm" variant="outline" onClick={() => unblockUser(u.id)}>
                    Unblock
                  </Button>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
