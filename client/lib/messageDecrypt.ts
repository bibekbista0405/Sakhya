"use client";

import { Message } from "@/types";
import { decryptFromPeer, getOwnDeviceId } from "./crypto";
import { getCachedPlaintext, setCachedPlaintext, deleteCachedPlaintext } from "./messageStore";

/**
 * Given a raw Message from the server (which for encrypted messages only
 * contains ciphertext), returns a copy with `content` set to the best
 * plaintext we can produce, plus flags describing how we got there.
 *
 * `pendingOwnPlaintext`: plaintext correlated to this exact outbound message
 * by the sender's ephemeral clientMessageId. It is known locally and never
 * needs to be decrypted from the sender's own Olm ciphertext.
 */
export async function resolveMessagePlaintext(
  message: Message,
  selfUserId: string,
  peerUserId: string,
  pendingOwnPlaintext?: string
): Promise<Message> {
  if (message.deletedAt) {
    // Delete-for-everyone is a local data-destruction event too. Never leave
    // the old decrypted plaintext in IndexedDB after the server has marked the
    // message deleted.
    await deleteCachedPlaintext(message.id).catch(() => undefined);
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

  const ownDeviceId = await getOwnDeviceId();
  const envelope = ownDeviceId
    ? message.encryptedEnvelopes?.find((candidate) => candidate.recipientDeviceId === ownDeviceId)
    : undefined;
  // If this is a message sent from another device belonging to the same
  // account, decrypt against selfUserId. The previous implementation treated
  // every sender-self message as undecryptable, which prevented true
  // multi-device history from working.
  const ciphertext = envelope?.ciphertext ?? message.ciphertext;
  const senderDeviceId = envelope?.senderDeviceId ?? message.senderDeviceId;
  const olmMessageType = envelope?.olmMessageType ?? message.olmMessageType;
  const decryptPeerUserId = message.senderId === selfUserId ? selfUserId : peerUserId;

  if (message.senderId === selfUserId && !envelope) {
    return { ...message, content: "", decryptError: true };
  }

  if (!ciphertext || !senderDeviceId || olmMessageType === null || olmMessageType === undefined) {
    return { ...message, content: "", decryptError: true };
  }

  try {
    const { plaintext, securityCodeChanged } = await decryptFromPeer(
      decryptPeerUserId,
      senderDeviceId,
      ciphertext,
      olmMessageType as 0 | 1
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
