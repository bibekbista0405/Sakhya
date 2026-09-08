"use client";

/**
 * Encrypted attachments (Phase 4).
 *
 * Each file gets its own random AES-256-GCM key + IV, generated and used
 * entirely client-side via the Web Crypto API. The server only ever receives
 * and stores the resulting ciphertext bytes — never the key, the IV, the
 * real MIME type, the filename, or the plaintext. The key/IV/metadata are
 * bundled into a small JSON object that becomes the PLAINTEXT of an ordinary
 * chat message, which then goes through the normal Olm encryption path
 * (see lib/crypto.ts) before it ever reaches the server. So an attachment's
 * metadata is protected by the same Double Ratchet session as regular text,
 * and only the (opaque, keyless) ciphertext blob is transferred separately.
 *
 * Known limitation: the server can still see the ciphertext SIZE and the
 * fact that an attachment was sent between two specific users at a specific
 * time — encrypting content doesn't hide traffic metadata. This is the same
 * trade-off accepted by Signal and WhatsApp.
 */

import { api, getStoredToken } from "./api";

export interface AttachmentMetadata {
  kind: "attachment";
  // Present for a not-yet-consumed attachment. Absent once a view-once
  // attachment has been consumed — see `consumed` below — so that even this
  // device's own local plaintext cache can no longer re-decrypt it.
  attachmentId?: string;
  key?: string; // base64 raw AES-256 key
  iv?: string; // base64, 12 bytes
  mimeType: string;
  fileName: string;
  size: number; // plaintext size, for UI display before download
  viewOnce?: boolean;
  /** True once this view-once attachment has been viewed (locally overwritten; see messageDecrypt usage). */
  consumed?: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024; // keep in sync with server MAX_ATTACHMENT_MB (ciphertext is only ~16 bytes larger)

/**
 * Encrypts a File/Blob, uploads the ciphertext, and returns the metadata
 * object to embed as the (pre-Olm) plaintext of the chat message.
 */
export async function encryptAndUploadAttachment(
  file: File,
  receiverId: string,
  viewOnce = false
): Promise<AttachmentMetadata> {
  if (file.size > MAX_PLAINTEXT_BYTES) {
    throw new Error(`File is too large. Maximum size is ${Math.floor(MAX_PLAINTEXT_BYTES / 1024 / 1024)}MB.`);
  }

  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const plaintextBuf = await file.arrayBuffer();
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintextBuf);

  const form = new FormData();
  form.append("receiverId", receiverId);
  form.append("viewOnce", viewOnce ? "true" : "false");
  form.append("file", new Blob([ciphertextBuf]), "ciphertext.bin");

  const token = getStoredToken();
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api") + "/attachments";
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "Failed to upload attachment");
  }

  return {
    kind: "attachment",
    attachmentId: data.attachmentId,
    key: toBase64(key),
    iv: toBase64(iv),
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
    size: file.size,
    viewOnce,
  };
}

/** Downloads an attachment's ciphertext and decrypts it into an object URL the UI can render/link to. */
export async function downloadAndDecryptAttachment(meta: AttachmentMetadata): Promise<string> {
  if (!meta.attachmentId || !meta.key || !meta.iv) {
    throw new Error("This media is no longer available.");
  }
  const token = getStoredToken();
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api") + `/attachments/${meta.attachmentId}`;
  const res = await fetch(apiUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Failed to download attachment");
  }
  const ciphertextBuf = await res.arrayBuffer();

  const cryptoKey = await crypto.subtle.importKey("raw", fromBase64(meta.key), "AES-GCM", false, ["decrypt"]);
  const plaintextBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(meta.iv) }, cryptoKey, ciphertextBuf);

  const blob = new Blob([plaintextBuf], { type: meta.mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Tells the server this view-once attachment has now been viewed, which
 * immediately deletes its ciphertext (see routes/attachments.ts for what
 * this can and can't actually guarantee). Only the recipient should call this.
 */
export async function consumeViewOnceAttachment(attachmentId: string): Promise<void> {
  await api.post(`/attachments/${attachmentId}/consume`, {});
}

/**
 * Strips the key/iv/attachmentId from a view-once attachment's metadata so
 * that even THIS device's local plaintext cache can no longer re-decrypt it
 * after viewing — see lib/messageStore.ts for why the plaintext cache exists
 * at all. Used to overwrite the cached "content" for a consumed message.
 */
export function toConsumedMetadata(meta: AttachmentMetadata): AttachmentMetadata {
  return {
    kind: "attachment",
    mimeType: meta.mimeType,
    fileName: meta.fileName,
    size: meta.size,
    viewOnce: true,
    consumed: true,
  };
}

/** Type guard + parser for decrypted message content that represents an attachment reference. */
export function parseAttachmentMetadata(plaintextContent: string): AttachmentMetadata | null {
  if (!plaintextContent || !plaintextContent.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(plaintextContent);
    if (!parsed || parsed.kind !== "attachment") return null;
    if (typeof parsed.mimeType !== "string" || typeof parsed.fileName !== "string" || typeof parsed.size !== "number") {
      return null;
    }
    if (parsed.consumed === true) {
      // Consumed view-once placeholder: no key/iv/attachmentId expected or required.
      return parsed as AttachmentMetadata;
    }
    if (typeof parsed.attachmentId !== "string" || typeof parsed.key !== "string" || typeof parsed.iv !== "string") {
      return null;
    }
    return parsed as AttachmentMetadata;
  } catch {
    return null;
  }
}
