"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Check, X, Clock, MessageCircle, ShieldOff, ShieldCheck, UserX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSocket } from "@/hooks/useSocket";
import { User, FriendRequest } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListItemSkeleton } from "@/components/ui/Skeleton";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const [friends, setFriends] = useState<User[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [blocked, setBlocked] = useState<User[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
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
    const onFriendAccept = (data: { friend?: User }) => {
      void loadAll();
      if (data.friend?.id) router.push(`/chats/${data.friend.id}`);
    };
    socket.on("friend_request", refresh);
    socket.on("friend_accept", onFriendAccept);
    return () => {
      socket.off("friend_request", refresh);
      socket.off("friend_accept", onFriendAccept);
    };
  }, [socket, loadAll, router]);

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

  async function sendRequest(userId: string) {
    setError(null);
    setBusyRequestId(userId);
    try {
      await api.post(`/friends/request/${userId}`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send request");
    } finally {
      setBusyRequestId(null);
    }
  }

  async function acceptRequest(requestId: string) {
    setError(null);
    setBusyRequestId(requestId);
    try {
      const res = await api.post<{ success: boolean; friend: User }>(`/friends/accept/${requestId}`);
      await loadAll();
      if (res.friend?.id) router.push(`/chats/${res.friend.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept request");
    } finally {
      setBusyRequestId(null);
    }
  }

  async function rejectRequest(requestId: string) {
    setError(null);
    setBusyRequestId(requestId);
    try {
      await api.post(`/friends/reject/${requestId}`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject request");
    } finally {
      setBusyRequestId(null);
    }
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
  const pendingTotal = incoming.length + outgoing.length;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col">
      <div className="border-b border-border bg-surface p-4">
        <h1 className="text-lg font-semibold">People</h1>
        <p className="text-sm text-muted">
          {friends.length} friends{onlineCount > 0 ? ` · ${onlineCount} online` : ""}
        </p>
        <div className="relative mt-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by username"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        {query.trim() ? (
          <section>
            <div className="mb-2 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">People</div>
            {searching && (
              <div className="flex flex-col gap-1 p-2">
                <ListItemSkeleton />
                <ListItemSkeleton />
              </div>
            )}
            {!searching && searchResults.length === 0 && (
              <EmptyState icon={Search} title="No users found" description="Try a different username." />
            )}
            {!searching && searchResults.map((u) => {
              const incomingRequest = incoming.find((r) => r.senderId === u.id);
              const outgoingRequest = outgoing.find((r) => r.receiverId === u.id);
              const isFriend = friends.some((f) => f.id === u.id);
              return (
                <div key={u.id} className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-surface-hover">
                  <Avatar src={u.avatar} name={u.username} size={44} online={u.online} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.username}</p>
                    {(u.firstName || u.lastName) && <p className="truncate text-xs text-muted">{u.firstName} {u.lastName}</p>}
                  </div>
                  {isFriend ? (
                    <Button size="sm" variant="outline" onClick={() => router.push(`/chats/${u.id}`)}>
                      <MessageCircle size={15} /> Chat
                    </Button>
                  ) : incomingRequest ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => acceptRequest(incomingRequest.id)} disabled={busyRequestId === incomingRequest.id}>Accept</Button>
                      <Button size="sm" variant="outline" onClick={() => rejectRequest(incomingRequest.id)} disabled={busyRequestId === incomingRequest.id}>Decline</Button>
                    </div>
                  ) : outgoingRequest ? (
                    <span className="flex items-center gap-1 text-xs text-muted"><Clock size={14} /> Pending</span>
                  ) : (
                    <Button size="sm" onClick={() => sendRequest(u.id)} disabled={busyRequestId === u.id}>
                      {busyRequestId === u.id ? "Sending…" : "Add"}
                    </Button>
                  )}
                </div>
              );
            })}
          </section>
        ) : (
          <>
            {incoming.length > 0 && (
              <section className="mb-5">
                <div className="mb-1 flex items-center justify-between px-2">
                  <div>
                    <h2 className="text-sm font-semibold">Friend requests</h2>
                    <p className="text-xs text-muted">People who want to connect with you</p>
                  </div>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{incoming.length}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {incoming.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 border-b border-border last:border-b-0 p-3">
                      <Avatar src={r.avatar} name={r.username} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.username}</p>
                        <p className="text-xs text-muted">Wants to be your friend</p>
                      </div>
                      <Button size="sm" onClick={() => acceptRequest(r.id)} disabled={busyRequestId === r.id}>
                        <Check size={15} /> Accept
                      </Button>
                      <button onClick={() => rejectRequest(r.id)} disabled={busyRequestId === r.id} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Decline ${r.username}`}>
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {outgoing.length > 0 && (
              <section className="mb-5">
                <div className="mb-1 px-2">
                  <h2 className="text-sm font-semibold">Sent requests</h2>
                  <p className="text-xs text-muted">Waiting for them to accept</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {outgoing.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 border-b border-border last:border-b-0 p-3">
                      <Avatar src={r.avatar} name={r.username} size={44} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.username}</span>
                      <span className="flex items-center gap-1 text-xs text-muted"><Clock size={14} /> Pending</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {loading && (
              <div className="flex flex-col gap-1 p-2"><ListItemSkeleton /><ListItemSkeleton /><ListItemSkeleton /></div>
            )}

            {!loading && friends.length === 0 && pendingTotal === 0 && (
              <EmptyState icon={UserX} title="No friends yet" description="Search above to find people and start a conversation." />
            )}

            {!loading && friends.length > 0 && (
              <section>
                <div className="mb-1 px-2">
                  <h2 className="text-sm font-semibold">Your friends</h2>
                  <p className="text-xs text-muted">Tap Chat to start a conversation</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {friends.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 border-b border-border last:border-b-0 p-3 hover:bg-surface-hover">
                      <Avatar src={f.avatar} name={f.username} size={44} online={onlineUserIds.has(f.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{f.username}</p>
                        <p className="truncate text-xs text-muted">{onlineUserIds.has(f.id) ? "Online" : "Offline"}</p>
                      </div>
                      <Button size="sm" onClick={() => router.push(`/chats/${f.id}`)}>
                        <MessageCircle size={15} /> Chat
                      </Button>
                      <button onClick={() => blockUser(f.id)} aria-label={`Block ${f.username}`} className="hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger sm:flex">
                        <ShieldOff size={17} />
                      </button>
                      <button onClick={() => removeFriend(f.id)} aria-label={`Remove ${f.username}`} className="hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger sm:flex">
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!loading && blocked.length > 0 && (
              <section className="mt-5">
                <div className="px-2">
                  <h2 className="text-sm font-semibold">Blocked</h2>
                  <p className="text-xs text-muted">Manage blocked people in Settings.</p>
                </div>
                <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface">
                  {blocked.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 border-b border-border last:border-b-0 p-3">
                      <Avatar src={u.avatar} name={u.username} size={40} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.username}</span>
                      <Button size="sm" variant="outline" onClick={() => unblockUser(u.id)}>Unblock</Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
