"use client";

import { idbGet, idbSet } from "./idb";

/**
 * Phase 3 — Security verification.
 *
 * This is a trust-on-first-use (TOFU) model, same as Signal/WhatsApp default
 * behavior: the first identity key we see for a contact is pinned locally
 * without any out-of-band check. If it later changes, we treat that as
 * noteworthy (could be a reinstall, a new device, or an attacker) and require
 * explicit acknowledgement before continuing to send — but we still allow
 * *receiving* and decrypting, matching how mainstream E2EE messengers behave
 * by default, so a legitimate device change doesn't silently drop messages.
 *
 * "Verified" here means the user manually confirmed the safety number out of
 * band (e.g. read it aloud on a call, or compared a QR code in person) — it
 * is a user attestation, not something this code can determine on its own.
 */

interface PinnedIdentity {
  deviceId: string;
  curveIdentityKey: string;
  ed25519IdentityKey: string;
  verified: boolean;
  verifiedAt: string | null;
  firstSeenAt: string;
}

function trustKey(peerUserId: string): string {
  return `sakhya:trust:${peerUserId}`;
}

export class IdentityKeyChangedError extends Error {
  constructor(public peerUserId: string) {
    super("This contact's security code has changed. Review it before sending.");
    this.name = "IdentityKeyChangedError";
  }
}

export async function getPinnedIdentity(peerUserId: string): Promise<PinnedIdentity | undefined> {
  return idbGet<PinnedIdentity>(trustKey(peerUserId));
}

/**
 * Call whenever we learn a peer's current identity key (before encrypting to
 * them, or when establishing a new inbound session from them).
 *
 * - First time seeing this peer: pins the key, returns { changed: false }.
 * - Same key as pinned: returns { changed: false }.
 * - Different key than pinned: does NOT overwrite the pin (so the change is
 *   still visible on the next check) and returns { changed: true }. Callers
 *   that should block (sending) should throw IdentityKeyChangedError; callers
 *   that should not block (receiving) can proceed but should surface a
 *   warning and then call acceptChangedIdentity() to update the pin.
 */
export async function checkIdentity(
  peerUserId: string,
  current: { deviceId: string; curveIdentityKey: string; ed25519IdentityKey: string }
): Promise<{ changed: boolean; previous?: PinnedIdentity }> {
  const pinned = await getPinnedIdentity(peerUserId);
  if (!pinned) {
    await idbSet(trustKey(peerUserId), {
      ...current,
      verified: false,
      verifiedAt: null,
      firstSeenAt: new Date().toISOString(),
    } satisfies PinnedIdentity);
    return { changed: false };
  }
  if (pinned.curveIdentityKey === current.curveIdentityKey && pinned.ed25519IdentityKey === current.ed25519IdentityKey) {
    return { changed: false };
  }
  return { changed: true, previous: pinned };
}

/** Explicitly accept a changed identity key, re-pinning it (always unverified until re-confirmed). */
export async function acceptChangedIdentity(
  peerUserId: string,
  current: { deviceId: string; curveIdentityKey: string; ed25519IdentityKey: string }
): Promise<void> {
  await idbSet(trustKey(peerUserId), {
    ...current,
    verified: false,
    verifiedAt: null,
    firstSeenAt: new Date().toISOString(),
  } satisfies PinnedIdentity);
}

export async function markVerified(peerUserId: string): Promise<void> {
  const pinned = await getPinnedIdentity(peerUserId);
  if (!pinned) return;
  await idbSet(trustKey(peerUserId), {
    ...pinned,
    verified: true,
    verifiedAt: new Date().toISOString(),
  } satisfies PinnedIdentity);
}

export async function markUnverified(peerUserId: string): Promise<void> {
  const pinned = await getPinnedIdentity(peerUserId);
  if (!pinned) return;
  await idbSet(trustKey(peerUserId), { ...pinned, verified: false, verifiedAt: null } satisfies PinnedIdentity);
}

/**
 * Computes a human-comparable "security code" from both parties' Ed25519
 * identity keys: SHA-256 over the two keys in a canonical (sorted) order,
 * rendered as groups of 5 decimal digits for easy side-by-side reading or
 * reading aloud. This is our own straightforward fingerprint construction —
 * it is NOT a byte-for-byte implementation of Signal's iterated-hash safety
 * number algorithm, but serves the same purpose: two devices that compute
 * this independently from the same identity keys will always get the same
 * code, and any MITM substituting a different key will produce a different
 * one.
 */
export async function computeSecurityCode(
  selfUserId: string,
  selfEd25519Key: string,
  peerUserId: string,
  peerEd25519Key: string
): Promise<{ groups: string[]; raw: string }> {
  const pair =
    selfUserId < peerUserId
      ? `${selfUserId}:${selfEd25519Key}|${peerUserId}:${peerEd25519Key}`
      : `${peerUserId}:${peerEd25519Key}|${selfUserId}:${selfEd25519Key}`;

  const data = new TextEncoder().encode(pair);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);

  // Render as 12 groups of 5 decimal digits (60 digits total, echoing
  // Signal's familiar display format) derived from the hash bytes.
  let bigDigits = "";
  for (const b of bytes) {
    bigDigits += b.toString().padStart(3, "0");
  }
  bigDigits = bigDigits.slice(0, 60).padEnd(60, "0");
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    groups.push(bigDigits.slice(i, i + 5));
  }

  return { groups, raw: Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("") };
}
