import { Conversation } from "@/types";

let conversations: Conversation[] | null = null;
let updatedAt = 0;

export function getConversationCache(): Conversation[] | null {
  return conversations;
}

export function setConversationCache(next: Conversation[]): void {
  conversations = next;
  updatedAt = Date.now();
}

export function isConversationCacheFresh(maxAge = 30_000): boolean {
  return !!conversations && Date.now() - updatedAt < maxAge;
}
