import { Message, User } from "@/types";

interface ChatCacheEntry {
  friend: User;
  messages: Message[];
  updatedAt: number;
}

const cache = new Map<string, ChatCacheEntry>();

export function getChatCache(friendId: string): ChatCacheEntry | null {
  return cache.get(friendId) ?? null;
}

export function setChatCache(friendId: string, friend: User, messages: Message[]): void {
  cache.set(friendId, { friend, messages, updatedAt: Date.now() });
}

export function updateCachedMessages(friendId: string, messages: Message[]): void {
  const entry = cache.get(friendId);
  if (!entry) return;
  entry.messages = messages;
  entry.updatedAt = Date.now();
}

export function isChatCacheFresh(friendId: string, maxAge = 30_000): boolean {
  const entry = cache.get(friendId);
  return !!entry && Date.now() - entry.updatedAt < maxAge;
}
