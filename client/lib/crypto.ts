"use client";

import { api, ApiError } from "./api";
import { idbGet, idbSet, idbDelete, idbClearAll, setIdbUserScope, getIdbUserScope } from "./idb";
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

  const register = async (): Promise<void> => {
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

    try {
      const res = await api.post<{ deviceId: string }>("/devices/register", {
        curveIdentityKey: identityKeys.curve25519,
        ed25519IdentityKey: identityKeys.ed25519,
        oneTimeKeys,
        ...(fallbackPayload ?? {}),
      });

      account.mark_keys_as_published();
      await persistAccount(account);
      await idbSet(DEVICE_ID_KEY, res.deviceId);
    } catch (err) {
      // A remotely revoked identity must never be resurrected. The server
      // rejects it with 409; discard this local identity and retry once with a
      // genuinely new Olm account/device identity.
      if (err instanceof ApiError && err.status === 409 && /encryption identity has been revoked/i.test(err.message)) {
        cachedAccount = null;
        await idbClearAll();
        await register();
        return;
      }
      throw err;
    }
  };

  deviceRegistrationPromise = register().finally(() => {
    deviceRegistrationPromise = null;
  });

  return deviceRegistrationPromise;
}

/** Tops up the one-time-key pool if the server reports it's running low. */
export async function maybeTopUpOneTimeKeys(): Promise<void> {
  // BUG FOUND ON RE-AUDIT: this mutated the shared Olm account (generate_one_time_keys,
  // mark_keys_as_published) and persisted it without withCryptoLock, while
  // encryptForPeer/decryptFromPeer do the same under the lock. Running
  // concurrently with either could lose an update to the persisted account
  // pickle (e.g. a one-time key encryptForPeer just consumed reappearing as
  // "unconsumed" after this function's persistAccount overwrites it with a
  // stale snapshot) — a real forward-secrecy risk, not just a data race.
  return withCryptoLock(() => maybeTopUpOneTimeKeysLocked());
}

async function maybeTopUpOneTimeKeysLocked(): Promise<void> {
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

async function getPeerIdentities(peerUserId: string): Promise<PeerIdentityCacheEntry[]> {
  const res = await api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>(
    `/devices/identity/${peerUserId}`
  );
  return res.devices.map((device) => ({
    deviceId: device.id,
    curveIdentityKey: device.curveIdentityKey,
    ed25519IdentityKey: device.ed25519IdentityKey,
    fetchedAt: Date.now(),
  }));
}

export interface EncryptedDeviceEnvelope {
  recipientDeviceId: string;
  ciphertext: string;
  olmMessageType: 0 | 1;
}

export interface EncryptedPayload {
  // Primary envelope fields remain for backwards compatibility with older
  // stored rows. New clients should use encryptedForDevices.
  ciphertext: string;
  olmMessageType: 0 | 1;
  senderDeviceId: string;
  encryptedForDevices: EncryptedDeviceEnvelope[];
}

/**
 * Encrypts one logical plaintext independently for every active device owned
 * by the peer. Each device gets its own Olm session/ratchet and therefore its
 * own ciphertext. This is true multi-device fan-out: adding or revoking a
 * device no longer silently changes which device receives messages.
 */
export async function encryptForPeer(peerUserId: string, plaintext: string): Promise<EncryptedPayload> {
  await ensureDeviceRegistered();
  return withCryptoLock(() => encryptForPeerLocked(peerUserId, plaintext));
}

async function encryptForPeerLocked(peerUserId: string, plaintext: string): Promise<EncryptedPayload> {
  const account = await loadOrCreateAccount();
  const Olm = await loadOlm();
  const identities = await getPeerIdentities(peerUserId);
  if (identities.length === 0) {
    throw new Error("This contact hasn't set up encryption on any device yet.");
  }

  // Preflight every identity before mutating any Olm session. If one device
  // changed identity, we must fail before advancing another device's ratchet;
  // otherwise the eventual send failure could leave a session one message
  // ahead and make the next message undecryptable.
  for (const identity of identities) {
    const trust = await checkIdentity(peerUserId, {
      deviceId: identity.deviceId,
      curveIdentityKey: identity.curveIdentityKey,
      ed25519IdentityKey: identity.ed25519IdentityKey,
    });
    if (trust.changed) throw new IdentityKeyChangedError(peerUserId);
  }

  const ownDeviceId = await requireOwnDeviceId();
  const ownDevicesRes = await api.get<{ devices: { id: string; curveIdentityKey: string; ed25519IdentityKey: string }[] }>("/devices");
  const ownOtherDevices = ownDevicesRes.devices.filter((device) => device.id !== ownDeviceId);

  type EncryptionTarget = { identity: PeerIdentityCacheEntry; isOwnDevice: boolean };
  type EncryptionPlan =
    | { target: EncryptionTarget; session: import("@matrix-org/olm").Session }
    | { target: EncryptionTarget; outboundKey: string };
  const targets: EncryptionTarget[] = [
    ...identities.map((identity) => ({ identity, isOwnDevice: false })),
    ...ownOtherDevices.map((device) => ({
      identity: {
        deviceId: device.id,
        curveIdentityKey: device.curveIdentityKey,
        ed25519IdentityKey: device.ed25519IdentityKey,
        fetchedAt: Date.now(),
      },
      isOwnDevice: true,
    })),
  ];
  const plans: EncryptionPlan[] = [];

  // Resolve all sessions/prekeys before mutating any ratchet. Bundle claiming
  // can consume a server-side one-time key, but it does not mutate our Olm
  // account/session state. If a device is temporarily unavailable, skip only
  // that device and continue fan-out to the healthy devices.
  for (const target of targets) {
    const { identity } = target;
    const sessionPeerId = target.isOwnDevice ? (getIdbUserScope() as string) : peerUserId;
    const existing = await loadSession(sessionPeerId, identity.deviceId);
    if (existing) {
      plans.push({ target, session: existing.session });
      continue;
    }

    try {
      const bundleRes = await api.get<{
        devices: {
          deviceId: string;
          curveIdentityKey: string;
          oneTimeKey: { keyId: string; publicKey: string } | null;
          fallbackKey: { keyId: string; publicKey: string; signature: string } | null;
        }[];
      }>(`/devices/bundle/${target.isOwnDevice ? getIdbUserScope() : peerUserId}?deviceId=${encodeURIComponent(identity.deviceId)}`);
      const bundle = bundleRes.devices[0];
      const outboundKey = bundle?.oneTimeKey?.publicKey ?? bundle?.fallbackKey?.publicKey;
      if (bundle && outboundKey) {
        plans.push({
          target: { ...target, identity: { ...identity, deviceId: bundle.deviceId, curveIdentityKey: bundle.curveIdentityKey } },
          outboundKey,
        });
      }
    } catch {
      // One unavailable device must not block delivery to the peer's other
      // active devices. It can establish its session on a later message.
    }
  }

  const envelopes: EncryptedDeviceEnvelope[] = [];
  for (const plan of plans) {
    const sessionPeerId = plan.target.isOwnDevice ? (getIdbUserScope() as string) : peerUserId;
    if ("session" in plan) {
      const encrypted = plan.session.encrypt(plaintext);
      await persistSession(sessionPeerId, plan.target.identity.deviceId, plan.session, plan.target.identity.curveIdentityKey);
      plan.session.free();
      envelopes.push({
        recipientDeviceId: plan.target.identity.deviceId,
        ciphertext: encrypted.body,
        olmMessageType: encrypted.type,
      });
      continue;
    }

    const session = new Olm.Session();
    session.create_outbound(account, plan.target.identity.curveIdentityKey, plan.outboundKey);
    const encrypted = session.encrypt(plaintext);
    await persistSession(sessionPeerId, plan.target.identity.deviceId, session, plan.target.identity.curveIdentityKey);
    session.free();
    envelopes.push({
      recipientDeviceId: plan.target.identity.deviceId,
      ciphertext: encrypted.body,
      olmMessageType: encrypted.type,
    });
  }

  if (envelopes.length === 0) {
    throw new Error("None of this contact's encryption devices has an available secure session.");
  }

  await persistAccount(account);
  const senderDeviceId = await requireOwnDeviceId();
  return {
    ciphertext: envelopes[0].ciphertext,
    olmMessageType: envelopes[0].olmMessageType,
    senderDeviceId,
    encryptedForDevices: envelopes,
  };
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
  let existing = await loadSession(peerUserId, senderDeviceId);

  if (existing) {
    try {
      const plaintext = existing.session.decrypt(olmMessageType, ciphertext);
      await persistSession(peerUserId, senderDeviceId, existing.session, existing.theirCurveIdentityKey);
      existing.session.free();
      return { plaintext, securityCodeChanged: false };
    } catch (err) {
      // A type-0 message is a complete Olm session-establishment message. If
      // we already have a stored session but that message fails MAC validation,
      // the stored session is stale (commonly after the sender reinstalled,
      // cleared storage, or recovered onto a new browser). Keeping the stale
      // ratchet makes every later message fail too. Safely discard ONLY that
      // stale session and rebuild from this authenticated type-0 message.
      if (olmMessageType === 0 && /BAD_MESSAGE_MAC|BAD_MESSAGE_KEY_ID|UNKNOWN_MESSAGE_INDEX/i.test(String(err))) {
        existing.session.free();
        await idbDelete(sessionKey(peerUserId, senderDeviceId));
        existing = null;
      } else {
        existing.session.free();
        throw err;
      }
    }
  }

  if (olmMessageType !== 0) {
    throw new Error("No usable session for this message and it isn't a session-establishing message.");
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


export interface EncryptedDecryptItem {
  messageId: string;
  peerUserId: string;
  senderDeviceId: string;
  ciphertext: string;
  olmMessageType: 0 | 1;
}

export interface BatchDecryptResult {
  plaintext: string;
  securityCodeChanged: boolean;
}

/**
 * Decrypt a chronological history batch without letting an old-history replay
 * corrupt the live Olm ratchet.  A persistent session may already be ahead of
 * the requested page (for example after reopening a chat). In that case the
 * batch may temporarily create a fresh inbound session from a type-0 message,
 * but it never overwrites the newer persistent session.
 */
export async function decryptMessageBatch(
  items: EncryptedDecryptItem[]
): Promise<Map<string, BatchDecryptResult | Error>> {
  if (items.length === 0) return new Map();
  await ensureDeviceRegistered();
  return withCryptoLock(async () => {
    const result = new Map<string, BatchDecryptResult | Error>();
    const sessions = new Map<string, {
      session: import("@matrix-org/olm").Session;
      theirCurveIdentityKey: string;
      wasPersistent: boolean;
      replacedPersistent: boolean;
    }>();
    const identityCache = new Map<string, Map<string, { curveIdentityKey: string; ed25519IdentityKey: string }>>();
    const account = await loadOrCreateAccount();
    const Olm = await loadOlm();

    const getIdentity = async (peerUserId: string, deviceId: string) => {
      let devices = identityCache.get(peerUserId);
      if (!devices) {
        const identities = await getPeerIdentities(peerUserId);
        devices = new Map(identities.map((d) => [d.deviceId, { curveIdentityKey: d.curveIdentityKey, ed25519IdentityKey: d.ed25519IdentityKey }]));
        identityCache.set(peerUserId, devices);
      }
      const identity = devices.get(deviceId);
      if (!identity) throw new Error("Could not verify the sender's device identity.");
      return identity;
    };

    const sessionKeyFor = (item: EncryptedDecryptItem) => `${item.peerUserId}\u0000${item.senderDeviceId}`;

    try {
      for (const item of items) {
        const key = sessionKeyFor(item);
        let state = sessions.get(key);
        if (!state) {
          const loaded = await loadSession(item.peerUserId, item.senderDeviceId);
          if (loaded) {
            state = { ...loaded, wasPersistent: true, replacedPersistent: false };
            sessions.set(key, state);
          }
        }

        let plaintext: string | null = null;
        let securityCodeChanged = false;

        if (state) {
          try {
            plaintext = state.session.decrypt(item.olmMessageType, item.ciphertext);
          } catch (err) {
            if (item.olmMessageType !== 0) {
              result.set(item.messageId, err instanceof Error ? err : new Error(String(err)));
              continue;
            }
            // A type-0 message is a new inbound session. Do not destroy the
            // existing persistent session until the replacement actually
            // authenticates and decrypts successfully.
            const identity = await getIdentity(item.peerUserId, item.senderDeviceId);
            const trust = await checkIdentity(item.peerUserId, {
              deviceId: item.senderDeviceId,
              curveIdentityKey: identity.curveIdentityKey,
              ed25519IdentityKey: identity.ed25519IdentityKey,
            });
            if (trust.changed) await acceptChangedIdentity(item.peerUserId, {
              deviceId: item.senderDeviceId,
              curveIdentityKey: identity.curveIdentityKey,
              ed25519IdentityKey: identity.ed25519IdentityKey,
            });
            const replacement = new Olm.Session();
            try {
              replacement.create_inbound_from(account, identity.curveIdentityKey, item.ciphertext);
              plaintext = replacement.decrypt(0, item.ciphertext);
              state.session.free();
              state = {
                session: replacement,
                theirCurveIdentityKey: identity.curveIdentityKey,
                wasPersistent: true,
                replacedPersistent: true,
              };
              sessions.set(key, state);
              securityCodeChanged = trust.changed;
              account.remove_one_time_keys(replacement);
            } catch (replacementErr) {
              replacement.free();
              result.set(item.messageId, replacementErr instanceof Error ? replacementErr : new Error(String(replacementErr)));
              continue;
            }
          }
        } else if (item.olmMessageType === 0) {
          const identity = await getIdentity(item.peerUserId, item.senderDeviceId);
          const trust = await checkIdentity(item.peerUserId, {
            deviceId: item.senderDeviceId,
            curveIdentityKey: identity.curveIdentityKey,
            ed25519IdentityKey: identity.ed25519IdentityKey,
          });
          if (trust.changed) await acceptChangedIdentity(item.peerUserId, {
            deviceId: item.senderDeviceId,
            curveIdentityKey: identity.curveIdentityKey,
            ed25519IdentityKey: identity.ed25519IdentityKey,
          });
          const inbound = new Olm.Session();
          try {
            inbound.create_inbound_from(account, identity.curveIdentityKey, item.ciphertext);
            plaintext = inbound.decrypt(0, item.ciphertext);
            account.remove_one_time_keys(inbound);
            state = {
              session: inbound,
              theirCurveIdentityKey: identity.curveIdentityKey,
              wasPersistent: false,
              replacedPersistent: false,
            };
            sessions.set(key, state);
            securityCodeChanged = trust.changed;
          } catch (err) {
            inbound.free();
            result.set(item.messageId, err instanceof Error ? err : new Error(String(err)));
            continue;
          }
        } else {
          result.set(item.messageId, new Error("No usable Olm session for this history message."));
          continue;
        }

        if (plaintext !== null) {
          result.set(item.messageId, { plaintext, securityCodeChanged });
        }
      }

      await persistAccount(account);
      for (const [key, state] of sessions.entries()) {
        // Never overwrite a newer persistent live session with a replayed
        // replacement. Otherwise persist the session state reached by this
        // chronological batch so the next live type-1 message continues from
        // exactly the same ratchet position.
        if (state.replacedPersistent) continue;
        const [peerUserId, senderDeviceId] = key.split("\u0000");
        await persistSession(peerUserId, senderDeviceId, state.session, state.theirCurveIdentityKey);
      }
    } finally {
      for (const state of sessions.values()) state.session.free();
    }
    return result;
  });
}

export async function getOwnDeviceId(): Promise<string | null> {
  return (await idbGet<string>(DEVICE_ID_KEY)) ?? null;
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

/**
 * Clears this tab's in-memory notion of "which account's crypto session is
 * active" — the in-memory Olm account handle, the device-registration
 * memoization, and the IndexedDB scope pointer. Does NOT delete anything
 * from IndexedDB (that's forgetDeviceIdentity(), a separate, destructive
 * action); the point here is just to stop a logged-out session from
 * lingering in memory with the previous user's scope still active.
 *
 * BUG FOUND ON RE-AUDIT: nothing called this on logout. setIdbUserScope only
 * ever got updated the NEXT time ensureDeviceRegistered ran with a new
 * userId, meaning between logout and the next login this module's notion of
 * "current user" stayed pointed at whoever just logged out. Not an active
 * security hole (the auth token is already cleared by then, so any stray
 * authenticated call would just fail), but a real correctness gap in a
 * feature whose entire purpose is per-account isolation.
 */
export function clearActiveCryptoSession(): void {
  cachedAccount = null;
  deviceRegistrationPromise = null;
  setIdbUserScope(null);
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
