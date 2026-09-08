"use client";

import { api } from "./api";
import { idbGet, idbSet, idbClearAll, setIdbUserScope, getIdbUserScope } from "./idb";
import { checkIdentity, acceptChangedIdentity, IdentityKeyChangedError } from "./trust";

// Loaded lazily so it never touches SSR and never blocks initial page load.
type OlmModule = typeof import("@matrix-org/olm");
let olmModule: OlmModule | null = null;
let olmLoadPromise: Promise<OlmModule> | null = null;

function loadOlm(): Promise<OlmModule> {
  if (olmLoadPromise) return olmLoadPromise;
  olmLoadPromise = import("@matrix-org/olm").then(async (mod) => {
    const Olm = mod.default ?? mod;
    await Olm.init({ locateFile: () => "/olm.wasm" });
    olmModule = Olm as unknown as OlmModule;
    return olmModule;
  });
  return olmLoadPromise;
}

const ACCOUNT_KEY = "sakhya:olm:account";
const PICKLE_SECRET_KEY = "sakhya:olm:pickle-secret";
const DEVICE_ID_KEY = "sakhya:olm:deviceId";
const OTK_TARGET_COUNT = 20;
const OTK_TOPUP_THRESHOLD = 8;

interface SessionRecord {
  pickled: string;
  theirCurveIdentityKey: string;
}

interface PeerIdentityCacheEntry {
  deviceId: string;
  curveIdentityKey: string;
  ed25519IdentityKey: string;
  fetchedAt: number;
}

// In-memory Olm.Account / Olm.Session objects are process-local WASM handles
// and are re-hydrated from their pickled (encrypted-at-rest-by-libolm) form
// on demand rather than kept around indefinitely.
let cachedAccount: import("@matrix-org/olm").Account | null = null;
let deviceRegistrationPromise: Promise<void> | null = null;

// Olm sessions are stateful ratchets. Two sends/decrypts for the same
// account/session must never mutate the same session concurrently. Web Locks
// also serializes access when the user has the same Sakhya account open in
// multiple browser tabs.
const localCryptoQueues = new Map<string, Promise<unknown>>();

async function withCryptoLock<T>(fn: () => Promise<T>): Promise<T> {
  const scope = getIdbUserScope();
  const lockName = `sakhya-olm:${scope ?? "uninitialized"}`;

  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
    return navigator.locks.request(lockName, { mode: "exclusive" }, fn);
  }

  const previous = localCryptoQueues.get(lockName) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(fn);
  localCryptoQueues.set(lockName, current);
  try {
    return await current;
  } finally {
    if (localCryptoQueues.get(lockName) === current) localCryptoQueues.delete(lockName);
  }
}

async function getPickleSecret(): Promise<string> {
  let secret = await idbGet<string>(PICKLE_SECRET_KEY);
  if (!secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    secret = btoa(String.fromCharCode(...bytes));
    await idbSet(PICKLE_SECRET_KEY, secret);
  }
  return secret;
}

async function loadOrCreateAccount(): Promise<import("@matrix-org/olm").Account> {
  if (cachedAccount) return cachedAccount;
  const Olm = await loadOlm();
  const pickleSecret = await getPickleSecret();
  const account = new Olm.Account();
  const pickled = await idbGet<string>(ACCOUNT_KEY);
  if (pickled) {
    account.unpickle(pickleSecret, pickled);
  } else {
    account.create();
    await idbSet(ACCOUNT_KEY, account.pickle(pickleSecret));
  }
  cachedAccount = account;
  return account;
}

async function persistAccount(account: import("@matrix-org/olm").Account): Promise<void> {
  const pickleSecret = await getPickleSecret();
  await idbSet(ACCOUNT_KEY, account.pickle(pickleSecret));
}

function sessionKey(peerUserId: string, theirDeviceId: string): string {
  return `sakhya:olm:session:${peerUserId}:${theirDeviceId}`;
}

async function loadSession(
  peerUserId: string,
  theirDeviceId: string
): Promise<{ session: import("@matrix-org/olm").Session; theirCurveIdentityKey: string } | null> {
  const record = await idbGet<SessionRecord>(sessionKey(peerUserId, theirDeviceId));
  if (!record) return null;
  const Olm = await loadOlm();
  const pickleSecret = await getPickleSecret();
  const session = new Olm.Session();
  session.unpickle(pickleSecret, record.pickled);
  return { session, theirCurveIdentityKey: record.theirCurveIdentityKey };
}

async function persistSession(
  peerUserId: string,
  theirDeviceId: string,
  session: import("@matrix-org/olm").Session,
  theirCurveIdentityKey: string
): Promise<void> {
  const pickleSecret = await getPickleSecret();
  const record: SessionRecord = { pickled: session.pickle(pickleSecret), theirCurveIdentityKey };
  await idbSet(sessionKey(peerUserId, theirDeviceId), record);
}

/**
 * Ensures this browser/device has an Olm identity and that its public keys
 * (plus a healthy pool of one-time prekeys) are registered with the server.
 * Idempotent — safe to call on every login/app load. Should be called after
 * successful authentication.
 */
export function ensureDeviceRegistered(userId?: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const currentScope = getIdbUserScope();
  if (userId && userId !== currentScope) {
    // A browser can log out of one Sakhya account and into another. Never
    // carry an in-memory Olm account or registration promise across users.
    cachedAccount = null;
    deviceRegistrationPromise = null;
    setIdbUserScope(userId);
  }
  const scopedUserId = userId ?? getIdbUserScope();
  if (!scopedUserId) return Promise.reject(new Error("Sakhya encryption account is not initialized yet."));
  if (deviceRegistrationPromise) return deviceRegistrationPromise;

  deviceRegistrationPromise = (async () => {
    const account = await loadOrCreateAccount();
  const identityKeys = JSON.parse(account.identity_keys()) as {
    curve25519: string;
    ed25519: string;
  };

  const existingDeviceId = await idbGet<string>(DEVICE_ID_KEY);

  // Generate a signed fallback key on first run so decrypt-side sessions can
  // still be established even after the one-time-key pool is exhausted.
  let fallbackPayload: { fallbackKeyId: string; fallbackKey: string; fallbackKeySignature: string } | null = null;
  if (!existingDeviceId) {
    account.generate_fallback_key();
    const unpublished = JSON.parse(account.unpublished_fallback_key()) as { curve25519: Record<string, string> };
    const [fallbackKeyId, fallbackKey] = Object.entries(unpublished.curve25519)[0];
    const fallbackKeySignature = account.sign(fallbackKey);
    fallbackPayload = { fallbackKeyId, fallbackKey, fallbackKeySignature };
  }

  const maxKeys = account.max_number_of_one_time_keys();
  const wantKeys = Math.min(OTK_TARGET_COUNT, maxKeys);
  account.generate_one_time_keys(wantKeys);
  const generated = JSON.parse(account.one_time_keys()) as { curve25519: Record<string, string> };
  const oneTimeKeys = Object.entries(generated.curve25519).map(([keyId, publicKey]) => ({ keyId, publicKey }));

  const res = await api.post<{ deviceId: string }>("/devices/register", {
    curveIdentityKey: identityKeys.curve25519,
    ed25519IdentityKey: identityKeys.ed25519,
    oneTimeKeys,
    ...(fallbackPayload ?? {}),
  });

    account.mark_keys_as_published();
    await persistAccount(account);
    await idbSet(DEVICE_ID_KEY, res.deviceId);
  })().finally(() => {
    deviceRegistrationPromise = null;
  });

  return deviceRegistrationPromise;
}

/** Tops up the one-time-key pool if the server reports it's running low. */
export async function maybeTopUpOneTimeKeys(): Promise<void> {
  await ensureDeviceRegistered();
  const deviceId = await idbGet<string>(DEVICE_ID_KEY);
  if (!deviceId) return;
  let devices: { id: string; remainingOneTimeKeys: number; lowOnKeys: boolean }[];
  try {
    const res = await api.get<{ devices: typeof devices }>("/devices");
    devices = res.devices;
  } catch {
    return;
  }
  const self = devices.find((d) => d.id === deviceId);
  if (!self || !self.lowOnKeys) return;

  const account = await loadOrCreateAccount();
  const maxKeys = account.max_number_of_one_time_keys();
  const wantKeys = Math.min(OTK_TOPUP_THRESHOLD * 2, maxKeys);
  account.generate_one_time_keys(wantKeys);
  const generated = JSON.parse(account.one_time_keys()) as { curve25519: Record<string, string> };
  const oneTimeKeys = Object.entries(generated.curve25519).map(([keyId, publicKey]) => ({ keyId, publicKey }));
  if (oneTimeKeys.length === 0) return;

  await api.post("/devices/prekeys", { deviceId, oneTimeKeys });
  account.mark_keys_as_published();
  await persistAccount(account);
}

async function getPeerIdentity(peerUserId: string): Promise<PeerIdentityCacheEntry | null> {
  const res = await api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>(
    `/devices/identity/${peerUserId}`
  );
  const device = res.devices[0]; // Most-recently-active device; see multi-device limitation below.
  if (!device) return null;
  return {
    deviceId: device.id,
    curveIdentityKey: device.curveIdentityKey,
    ed25519IdentityKey: device.ed25519IdentityKey,
    fetchedAt: Date.now(),
  };
}

export interface EncryptedPayload {
  ciphertext: string;
  olmMessageType: 0 | 1;
  senderDeviceId: string;
}

/**
 * Encrypts a plaintext message for a peer's device.
 *
 * KNOWN LIMITATION: if the recipient has more than one registered device,
 * this only encrypts for their single most-recently-active device (the first
 * entry returned by the bundle endpoint). True multi-device fan-out (sending
 * a separately-encrypted copy to every device, as Signal/WhatsApp do) is not
 * implemented yet — a recipient reading from a second device will not see
 * messages sent while that device wasn't the "primary" one.
 */
export async function encryptForPeer(peerUserId: string, plaintext: string): Promise<EncryptedPayload> {
  await ensureDeviceRegistered();
  return withCryptoLock(() => encryptForPeerLocked(peerUserId, plaintext));
}

async function encryptForPeerLocked(peerUserId: string, plaintext: string): Promise<EncryptedPayload> {
  const account = await loadOrCreateAccount();
  const Olm = await loadOlm();

  // Reuse an existing session with the peer's currently-known primary device
  // if we have one; otherwise establish a new one via a fresh prekey bundle.
  const identity = await getPeerIdentity(peerUserId);
  if (!identity) {
    throw new Error("This contact hasn't set up encryption on any device yet.");
  }

  // Phase 3: refuse to send to a changed, unacknowledged identity key. The
  // caller (UI) should catch IdentityKeyChangedError, show the new security
  // code, and call acceptChangedIdentity() before retrying.
  const trust = await checkIdentity(peerUserId, {
    deviceId: identity.deviceId,
    curveIdentityKey: identity.curveIdentityKey,
    ed25519IdentityKey: identity.ed25519IdentityKey,
  });
  if (trust.changed) {
    throw new IdentityKeyChangedError(peerUserId);
  }

  const existing = await loadSession(peerUserId, identity.deviceId);
  if (existing) {
    const encrypted = existing.session.encrypt(plaintext);
    await persistSession(peerUserId, identity.deviceId, existing.session, identity.curveIdentityKey);
    existing.session.free();
    return { ciphertext: encrypted.body, olmMessageType: encrypted.type, senderDeviceId: await requireOwnDeviceId() };
  }

  // No session yet: claim a prekey bundle (consumes a one-time key server-side).
  const bundleRes = await api.get<{
    devices: {
      deviceId: string;
      curveIdentityKey: string;
      oneTimeKey: { keyId: string; publicKey: string } | null;
      fallbackKey: { keyId: string; publicKey: string; signature: string } | null;
    }[];
  }>(`/devices/bundle/${peerUserId}`);
  const bundle = bundleRes.devices.find((d) => d.deviceId === identity.deviceId) ?? bundleRes.devices[0];
  if (!bundle) {
    throw new Error("This contact hasn't set up encryption on any device yet.");
  }
  const theirOtk = bundle.oneTimeKey?.publicKey ?? bundle.fallbackKey?.publicKey;
  if (!theirOtk) {
    throw new Error("This contact's device has no available prekeys to start a secure session.");
  }

  const session = new Olm.Session();
  session.create_outbound(account, bundle.curveIdentityKey, theirOtk);
  const encrypted = session.encrypt(plaintext);
  await persistSession(peerUserId, bundle.deviceId, session, bundle.curveIdentityKey);
  session.free();
  await persistAccount(account);

  return { ciphertext: encrypted.body, olmMessageType: encrypted.type, senderDeviceId: await requireOwnDeviceId() };
}

/**
 * Decrypts a message from a peer's device. Creates an inbound session
 * automatically from a PreKey (type 0) message if none exists yet.
 *
 * Unlike encryptForPeer, this does NOT block on a changed identity key —
 * refusing to decrypt could silently drop a legitimate message (e.g. after
 * the peer reinstalled). Instead it decrypts, re-pins the new key, and flags
 * `securityCodeChanged` so the UI can show a warning banner without losing
 * the message, matching how mainstream E2EE messengers handle this by default.
 */
export async function decryptFromPeer(
  peerUserId: string,
  senderDeviceId: string,
  ciphertext: string,
  olmMessageType: 0 | 1
): Promise<{ plaintext: string; securityCodeChanged: boolean }> {
  await ensureDeviceRegistered();
  return withCryptoLock(() => decryptFromPeerLocked(peerUserId, senderDeviceId, ciphertext, olmMessageType));
}

async function decryptFromPeerLocked(
  peerUserId: string,
  senderDeviceId: string,
  ciphertext: string,
  olmMessageType: 0 | 1
): Promise<{ plaintext: string; securityCodeChanged: boolean }> {
  const Olm = await loadOlm();
  const existing = await loadSession(peerUserId, senderDeviceId);

  if (existing) {
    const plaintext = existing.session.decrypt(olmMessageType, ciphertext);
    await persistSession(peerUserId, senderDeviceId, existing.session, existing.theirCurveIdentityKey);
    existing.session.free();
    return { plaintext, securityCodeChanged: false };
  }

  if (olmMessageType !== 0) {
    throw new Error("No session for this message and it isn't a session-establishing message.");
  }

  const account = await loadOrCreateAccount();
  // Need the sender's public identity key to build the inbound session record;
  // it's public information, safe to fetch even without an existing session.
  const identityRes = await api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>(
    `/devices/identity/${peerUserId}`
  );
  const senderDevice = identityRes.devices.find((d) => d.id === senderDeviceId);
  if (!senderDevice) {
    throw new Error("Could not verify the sender's device identity.");
  }

  const trust = await checkIdentity(peerUserId, {
    deviceId: senderDeviceId,
    curveIdentityKey: senderDevice.curveIdentityKey,
    ed25519IdentityKey: senderDevice.ed25519IdentityKey,
  });
  if (trust.changed) {
    await acceptChangedIdentity(peerUserId, {
      deviceId: senderDeviceId,
      curveIdentityKey: senderDevice.curveIdentityKey,
      ed25519IdentityKey: senderDevice.ed25519IdentityKey,
    });
  }

  const session = new Olm.Session();
  session.create_inbound_from(account, senderDevice.curveIdentityKey, ciphertext);
  const plaintext = session.decrypt(olmMessageType, ciphertext);
  account.remove_one_time_keys(session);
  await persistAccount(account);
  await persistSession(peerUserId, senderDeviceId, session, senderDevice.curveIdentityKey);
  session.free();
  return { plaintext, securityCodeChanged: trust.changed };
}

async function requireOwnDeviceId(): Promise<string> {
  const id = await idbGet<string>(DEVICE_ID_KEY);
  if (!id) throw new Error("This device has not registered an encryption identity yet.");
  return id;
}

export async function isDeviceRegistered(): Promise<boolean> {
  const id = await idbGet<string>(DEVICE_ID_KEY);
  return !!id;
}

/** Returns this device's own public identity keys, for display in the security verification UI. */
export async function getOwnIdentityKeys(): Promise<{ curve25519: string; ed25519: string }> {
  if (!getIdbUserScope()) throw new Error("Sakhya encryption account is not initialized yet.");
  const account = await loadOrCreateAccount();
  return JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
}

/** Wipes all local key material. Use when the user explicitly wants to forget this device's identity. */
export async function forgetDeviceIdentity(): Promise<void> {
  cachedAccount = null;
  await idbClearAll();
}
