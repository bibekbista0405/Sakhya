"use client";

import { idbGet, idbSet } from "./idb";

/**
 * Caches DECRYPTED plaintext locally, keyed by message id.
 *
 * This exists because Olm (like the Signal Protocol's Double Ratchet) derives
 * a fresh key for each message and does not support arbitrarily re-decrypting
 * the same ciphertext once the session has moved past it. Real E2EE clients
 * therefore decrypt each message exactly once, on first receipt, and persist
 * the plaintext locally — history views read from that local store rather
 * than re-decrypting from the server on every page load. This is that store.
 *
 * Known limitation: if this cache is cleared (or a message is opened for the
 * first time on a device other than the one that originally sent/received
 * it), the ciphertext may no longer be decryptable. That's a fundamental
 * property of forward-secret ratcheting, not a bug — but it does mean there
 * is currently no cross-device message history for E2EE conversations.
 */
function key(messageId: string): string {
  return `sakhya:msg-plaintext:${messageId}`;
}

export async function getCachedPlaintext(messageId: string): Promise<string | undefined> {
  return idbGet<string>(key(messageId));
}

export async function setCachedPlaintext(messageId: string, plaintext: string): Promise<void> {
  await idbSet(key(messageId), plaintext);
}
