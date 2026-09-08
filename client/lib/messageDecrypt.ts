"use client";

import { Message } from "@/types";
import { decryptFromPeer } from "./crypto";
import { getCachedPlaintext, setCachedPlaintext } from "./messageStore";

/**
 * Given a raw Message from the server (which for encrypted messages only
 * contains ciphertext), returns a copy with `content` set to the best
 * plaintext we can produce, plus flags describing how we got there.
 *
 * `pendingOwnPlaintext`: for the sender's own just-sent message, the plaintext
 * they typed (known locally, never needs decrypting — see the note in
 * messageStore.ts on why Olm ciphertext can't generally be re-decrypted by
 * its own sender).
 */
export async function resolveMessagePlaintext(
  message: Message,
  selfUserId: string,
  peerUserId: string,
  pendingOwnPlaintext?: string
): Promise<Message> {
  if (message.deletedAt) {
    return { ...message, content: "" };
  }

  if (!message.isEncrypted) {
    // Legacy pre-E2EE message: content is already plaintext, stored as such
    // before this device's crypto existed. Never implied to be encrypted.
    return message;
  }

  const cached = await getCachedPlaintext(message.id);
  if (cached !== undefined) {
    return { ...message, content: cached, decryptError: false };
  }

  if (pendingOwnPlaintext !== undefined) {
    await setCachedPlaintext(message.id, pendingOwnPlaintext);
    return { ...message, content: pendingOwnPlaintext, decryptError: false };
  }

  if (message.senderId === selfUserId) {
    // Our own encrypted message with no local plaintext record (e.g. sent
    // from a different device/session, or the cache was cleared). Olm does
    // not let a sender re-decrypt their own outbound ciphertext.
    return { ...message, content: "", decryptError: true };
  }

  if (!message.ciphertext || !message.senderDeviceId || message.olmMessageType === null || message.olmMessageType === undefined) {
    return { ...message, content: "", decryptError: true };
  }

  try {
    const { plaintext, securityCodeChanged } = await decryptFromPeer(
      peerUserId,
      message.senderDeviceId,
      message.ciphertext,
      message.olmMessageType as 0 | 1
    );
    await setCachedPlaintext(message.id, plaintext);
    return { ...message, content: plaintext, decryptError: false, securityCodeChanged };
  } catch (err) {
    console.error("Failed to decrypt message", message.id, err);
    return { ...message, content: "", decryptError: true };
  }
}

/** Sequentially resolves a list of messages, preserving order (required — see messageStore.ts). */
export async function resolveMessageList(
  messages: Message[],
  selfUserId: string,
  peerUserId: string,
  signal?: AbortSignal
): Promise<Message[]> {
  const resolved: Message[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (signal?.aborted) throw new DOMException("Message decryption cancelled", "AbortError");
    resolved.push(await resolveMessagePlaintext(messages[i], selfUserId, peerUserId));
    // Yield between small batches so navigation/input stays responsive while
    // a large chat history is being decrypted by libolm.
    if (i % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return resolved;
}
