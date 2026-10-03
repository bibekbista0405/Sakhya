import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { db } from "../db";
import { requireAuth, AuthedRequest, describeDevice } from "../middleware/auth";
import { DeviceRow, PrekeyBundle, PublicDevice } from "../types";
import { sanitizeString, areFriends, isBlocked } from "../utils/helpers";
import { sensitiveSettingsLimiter } from "../middleware/rateLimit";

const router = Router();

const MAX_ONE_TIME_KEYS_PER_UPLOAD = 100;
const MIN_ONE_TIME_KEY_POOL_WARNING = 10; // informational only, surfaced in the response

function isBase64Key(value: unknown, minLen = 16, maxLen = 256): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLen &&
    value.length <= maxLen &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

function hashPairingSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function randomPairingSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function toPublicDevice(row: DeviceRow): PublicDevice {
  return {
    id: row.id,
    name: row.name,
    curveIdentityKey: row.curveIdentityKey,
    ed25519IdentityKey: row.ed25519IdentityKey,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
  };
}

/**
 * Register (or re-register) this device's identity keys, signed fallback key,
 * and an initial batch of one-time prekeys. Called once per device the first
 * time E2EE is set up, and again whenever the fallback key needs rotating.
 * The private counterparts to every key here must never be sent to the server.
 */
router.post("/register", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const curveIdentityKey = req.body?.curveIdentityKey;
  const ed25519IdentityKey = req.body?.ed25519IdentityKey;
  const fallbackKeyId = sanitizeString(req.body?.fallbackKeyId, 100);
  const fallbackKey = req.body?.fallbackKey;
  const fallbackKeySignature = req.body?.fallbackKeySignature;
  const oneTimeKeys = Array.isArray(req.body?.oneTimeKeys) ? req.body.oneTimeKeys : [];
  const deviceNameOverride = sanitizeString(req.body?.deviceName, 60);

  if (!isBase64Key(curveIdentityKey) || !isBase64Key(ed25519IdentityKey)) {
    res.status(400).json({ error: "Invalid or missing identity keys" });
    return;
  }
  if (fallbackKey && (!fallbackKeyId || !isBase64Key(fallbackKey) || !isBase64Key(fallbackKeySignature, 16, 256))) {
    res.status(400).json({ error: "Invalid fallback key or signature" });
    return;
  }
  if (oneTimeKeys.length > MAX_ONE_TIME_KEYS_PER_UPLOAD) {
    res.status(400).json({ error: `Cannot upload more than ${MAX_ONE_TIME_KEYS_PER_UPLOAD} one-time keys at once` });
    return;
  }
  for (const otk of oneTimeKeys) {
    if (!otk || !sanitizeString(otk.keyId, 100) || !isBase64Key(otk.publicKey)) {
      res.status(400).json({ error: "Invalid one-time key in batch" });
      return;
    }
  }

  const existing = db
    .prepare(`SELECT * FROM devices WHERE userId = ? AND curveIdentityKey = ?`)
    .get(userId, curveIdentityKey) as DeviceRow | undefined;

  const deviceName =
    deviceNameOverride || existing?.name || describeDevice(req.headers["user-agent"] as string | undefined);

  let deviceId: string;
  const hadExistingDevices = !!db.prepare(`SELECT 1 FROM devices WHERE userId = ? LIMIT 1`).get(userId);
  if (existing) {
    if (existing.revokedAt) {
      // A revoked cryptographic identity is permanently dead. Never resurrect
      // it just because the browser still has its local Olm pickle. The client
      // must generate a fresh identity and register that as a new device.
      res.status(409).json({ error: "This encryption identity has been revoked; create a new device identity" });
      return;
    }
    deviceId = existing.id;
    db.prepare(
      `UPDATE devices SET name = ?, ed25519IdentityKey = ?, fallbackKeyId = ?, fallbackKey = ?, fallbackKeySignature = ?, lastActiveAt = datetime('now') WHERE id = ?`
    ).run(
      deviceName,
      ed25519IdentityKey,
      fallbackKeyId || existing.fallbackKeyId,
      fallbackKey || existing.fallbackKey,
      fallbackKeySignature || existing.fallbackKeySignature,
      deviceId
    );
  } else {
    deviceId = uuidv4();
    const hasPrimary = db.prepare(`SELECT 1 FROM devices WHERE userId = ? AND isPrimary = 1 LIMIT 1`).get(userId);
    db.prepare(
      `INSERT INTO devices (id, userId, name, curveIdentityKey, ed25519IdentityKey, fallbackKeyId, fallbackKey, fallbackKeySignature, isPrimary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      deviceId,
      userId,
      deviceName,
      curveIdentityKey,
      ed25519IdentityKey,
      fallbackKeyId || null,
      fallbackKey || null,
      fallbackKeySignature || null,
      hasPrimary ? 0 : 1
    );
  }

  if (!existing && hadExistingDevices) {
    db.prepare(`INSERT INTO notifications (id,userId,type,content,relatedId) VALUES (?,?,?,?,?)`).run(
      uuidv4(), userId, "new_device", `New Sakhya device registered: ${deviceName}`, deviceId
    );
  }

  const insertOtk = db.prepare(
    `INSERT OR IGNORE INTO one_time_prekeys (id, deviceId, keyId, publicKey) VALUES (?, ?, ?, ?)`
  );
  for (const otk of oneTimeKeys) {
    insertOtk.run(uuidv4(), deviceId, otk.keyId, otk.publicKey);
  }

  // Tie this device to the auth session making the request, so revoking one
  // from Settings → Devices can revoke the other.
  if (req.sessionId) {
    db.prepare(`UPDATE sessions SET deviceId = ? WHERE id = ?`).run(deviceId, req.sessionId);
  }

  res.status(existing ? 200 : 201).json({ deviceId });
});

/** Top up the one-time-prekey pool without touching identity/fallback keys. */
router.post("/prekeys", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const deviceId = sanitizeString(req.body?.deviceId, 100);
  const oneTimeKeys = Array.isArray(req.body?.oneTimeKeys) ? req.body.oneTimeKeys : [];

  if (!deviceId || oneTimeKeys.length === 0 || oneTimeKeys.length > MAX_ONE_TIME_KEYS_PER_UPLOAD) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const device = db
    .prepare(`SELECT id FROM devices WHERE id = ? AND userId = ? AND revokedAt IS NULL`)
    .get(deviceId, userId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  for (const otk of oneTimeKeys) {
    if (!otk || !sanitizeString(otk.keyId, 100) || !isBase64Key(otk.publicKey)) {
      res.status(400).json({ error: "Invalid one-time key in batch" });
      return;
    }
  }

  const insertOtk = db.prepare(
    `INSERT OR IGNORE INTO one_time_prekeys (id, deviceId, keyId, publicKey) VALUES (?, ?, ?, ?)`
  );
  const insertMany = db.transaction((keys: { keyId: string; publicKey: string }[]) => {
    for (const otk of keys) insertOtk.run(uuidv4(), deviceId, otk.keyId, otk.publicKey);
  });
  insertMany(oneTimeKeys);

  res.json({ success: true });
});

/**
 * Fetch a prekey bundle for every active device belonging to a peer, claiming
 * (consuming) one one-time key per device so it can't be reused for a second
 * session — replay protection at the key-exchange layer. Falls back to the
 * device's signed fallback key if its one-time-key pool is empty.
 * Only friends may fetch each other's bundles, matching the messaging policy.
 */
router.get("/bundle/:userId", requireAuth, (req: AuthedRequest, res: Response) => {
  const requesterId = req.user!.userId;
  const targetUserId = req.params.userId;
  const requestedDeviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.slice(0, 100) : "";

  if (!requestedDeviceId) {
    res.status(400).json({ error: "deviceId is required when establishing an encrypted session" });
    return;
  }
  if (targetUserId !== requesterId && !areFriends(requesterId, targetUserId)) {
    res.status(403).json({ error: "You can only establish encrypted sessions with friends" });
    return;
  }
  if (isBlocked(requesterId, targetUserId)) {
    res.status(403).json({ error: "You cannot establish a session with this user" });
    return;
  }

  const device = db
    .prepare(`SELECT * FROM devices WHERE id = ? AND userId = ? AND revokedAt IS NULL`)
    .get(requestedDeviceId, targetUserId) as DeviceRow | undefined;

  if (!device) {
    res.status(404).json({ error: "Encryption device not found or revoked" });
    return;
  }

  // Claim the OTK with a conditional UPDATE. The old SELECT-then-UPDATE
  // sequence had a race: two simultaneous requests could both read the same
  // unclaimed key before either request marked it claimed. Only the request
  // whose UPDATE changes one row is allowed to receive the key.
  let oneTimeKey: PrekeyBundle["oneTimeKey"] = null;
  for (let attempt = 0; attempt < 3 && !oneTimeKey; attempt += 1) {
    const candidate = db
      .prepare(
        `SELECT id, keyId, publicKey FROM one_time_prekeys
         WHERE deviceId = ? AND claimedAt IS NULL
         ORDER BY createdAt ASC LIMIT 1`
      )
      .get(device.id) as { id: string; keyId: string; publicKey: string } | undefined;

    if (!candidate) break;

    const claimed = db
      .prepare(
        `UPDATE one_time_prekeys
         SET claimedByUserId = ?, claimedAt = datetime('now')
         WHERE id = ? AND deviceId = ? AND claimedAt IS NULL`
      )
      .run(requesterId, candidate.id, device.id);

    if (claimed.changes === 1) {
      oneTimeKey = { keyId: candidate.keyId, publicKey: candidate.publicKey };
    }
  }

  const fallbackKey =
    !oneTimeKey && device.fallbackKey && device.fallbackKeyId && device.fallbackKeySignature
      ? { keyId: device.fallbackKeyId, publicKey: device.fallbackKey, signature: device.fallbackKeySignature }
      : null;

  res.json({
    userId: targetUserId,
    devices: [{
      deviceId: device.id,
      deviceName: device.name,
      curveIdentityKey: device.curveIdentityKey,
      ed25519IdentityKey: device.ed25519IdentityKey,
      oneTimeKey,
      fallbackKey,
    }],
  });
});

/**
 * Look up a peer's device identity keys WITHOUT claiming a one-time key.
 * Needed on the decrypt side: to create an inbound Olm session from a
 * PreKey message, the recipient needs the sender's Curve25519 identity key,
 * which is public and doesn't require consuming any single-use material.
 */
router.get("/identity/:userId", requireAuth, (req: AuthedRequest, res: Response) => {
  const requesterId = req.user!.userId;
  const targetUserId = req.params.userId;

  if (targetUserId !== requesterId && !areFriends(requesterId, targetUserId)) {
    res.status(403).json({ error: "You can only look up identity keys for friends" });
    return;
  }
  if (isBlocked(requesterId, targetUserId)) {
    res.status(403).json({ error: "You cannot look up this user" });
    return;
  }

  const devices = db
    .prepare(
      `SELECT id, name, curveIdentityKey, ed25519IdentityKey, createdAt, lastActiveAt FROM devices WHERE userId = ? AND revokedAt IS NULL`
    )
    .all(targetUserId) as DeviceRow[];

  res.json({ userId: targetUserId, devices: devices.map(toPublicDevice) });
});

db.prepare(`DELETE FROM device_pairings WHERE datetime(expiresAt) < datetime('now')`).run();

/** List the current account's own registered devices (crypto identity, not just login sessions). */
router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM devices WHERE userId = ? AND revokedAt IS NULL ORDER BY isPrimary DESC, lastActiveAt DESC`)
    .all(req.user!.userId) as DeviceRow[];

  const remainingKeys = db
    .prepare(
      `SELECT deviceId, COUNT(*) as c FROM one_time_prekeys WHERE claimedAt IS NULL AND deviceId IN (${rows
        .map(() => "?")
        .join(",") || "''"}) GROUP BY deviceId`
    )
    .all(...rows.map((r) => r.id)) as { deviceId: string; c: number }[];
  const remainingByDevice = new Map(remainingKeys.map((r) => [r.deviceId, r.c]));

  const currentSession = req.sessionId ? db.prepare(`SELECT deviceId FROM sessions WHERE id = ? AND userId = ?`).get(req.sessionId, req.user!.userId) as {deviceId:string|null}|undefined : undefined;

  res.json({
    devices: rows.map((r) => ({
      ...toPublicDevice(r),
      remainingOneTimeKeys: remainingByDevice.get(r.id) ?? 0,
      lowOnKeys: (remainingByDevice.get(r.id) ?? 0) < MIN_ONE_TIME_KEY_POOL_WARNING,
      isPrimary: !!r.isPrimary,
      isCurrent: currentSession?.deviceId === r.id,
    })),
  });
});

/**
 * Revoke a device: marks its identity keys dead (no new sessions can be
 * established against it) and deletes any of its unclaimed one-time keys.
 * Existing Olm sessions other devices already hold are unaffected by this —
 * they must independently detect the identity-key change (Phase 3).
 */
router.patch("/:id", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const name = sanitizeString(req.body?.name, 60);
  if (!name) { res.status(400).json({ error: "Device name is required" }); return; }
  const result = db.prepare(`UPDATE devices SET name = ? WHERE id = ? AND userId = ? AND revokedAt IS NULL`).run(name, req.params.id, req.user!.userId);
  if (!result.changes) { res.status(404).json({ error: "Device not found" }); return; }
  res.json({ success: true, name });
});

router.delete("/:id", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const device = db.prepare(`SELECT id FROM devices WHERE id = ? AND userId = ? AND revokedAt IS NULL`).get(req.params.id, userId);
  if (!device) { res.status(404).json({ error: "Device not found" }); return; }
  db.prepare(`UPDATE devices SET revokedAt = datetime('now') WHERE id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM one_time_prekeys WHERE deviceId = ? AND claimedAt IS NULL`).run(req.params.id);
  db.prepare(`DELETE FROM sessions WHERE deviceId = ?`).run(req.params.id);
  res.json({ success: true });
});

router.post("/revoke-others", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const current = req.sessionId ? db.prepare(`SELECT deviceId FROM sessions WHERE id = ? AND userId = ?`).get(req.sessionId, req.user!.userId) as {deviceId: string | null} | undefined : undefined;
  if (!current?.deviceId) { res.status(409).json({ error: "Current device is not registered yet" }); return; }
  const devices = db.prepare(`SELECT id FROM devices WHERE userId = ? AND id != ? AND revokedAt IS NULL`).all(req.user!.userId, current.deviceId) as {id:string}[];
  const revoke = db.transaction((ids: string[]) => {
    for (const id of ids) {
      db.prepare(`UPDATE devices SET revokedAt = datetime('now') WHERE id = ?`).run(id);
      db.prepare(`DELETE FROM one_time_prekeys WHERE deviceId = ? AND claimedAt IS NULL`).run(id);
      db.prepare(`DELETE FROM sessions WHERE deviceId = ?`).run(id);
    }
  });
  revoke(devices.map(d => d.id));
  res.json({ success: true, revokedCount: devices.length });
});

router.post("/pairing/create", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const secret = randomPairingSecret();
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const device = req.sessionId ? db.prepare(`SELECT deviceId FROM sessions WHERE id = ? AND userId = ?`).get(req.sessionId, req.user!.userId) as {deviceId:string|null}|undefined : undefined;
  db.prepare(`INSERT INTO device_pairings (id,userId,secretHash,expiresAt,approvedByDeviceId,targetDeviceName) VALUES (?,?,?,?,?,?)`).run(id, req.user!.userId, hashPairingSecret(secret), expiresAt, device?.deviceId ?? null, sanitizeString(req.body?.targetDeviceName,60) || "New device");
  res.status(201).json({ pairingId: id, secret, expiresAt, payload: `sakhya-pair:v1:${id}:${secret}` });
});

router.post("/pairing/approve", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const pairingId = sanitizeString(req.body?.pairingId, 100);
  const secret = sanitizeString(req.body?.secret, 200);
  if (!pairingId || !secret) { res.status(400).json({ error: "Pairing code is required" }); return; }
  const pairing = db.prepare(`SELECT * FROM device_pairings WHERE id = ? AND userId = ?`).get(pairingId, req.user!.userId) as any;
  if (!pairing || pairing.status !== "pending" || new Date(pairing.expiresAt).getTime() < Date.now()) { res.status(410).json({ error: "Pairing request expired or already used" }); return; }
  if (!crypto.timingSafeEqual(Buffer.from(pairing.secretHash), Buffer.from(hashPairingSecret(secret)))) { res.status(403).json({ error: "Invalid pairing code" }); return; }
  const sessionDevice = req.sessionId ? db.prepare(`SELECT deviceId FROM sessions WHERE id = ?`).get(req.sessionId) as {deviceId:string|null}|undefined : undefined;
  db.prepare(`UPDATE device_pairings SET status = 'approved', approvedAt = datetime('now'), approvedByDeviceId = ? WHERE id = ?`).run(sessionDevice?.deviceId ?? null, pairingId);
  res.json({ success: true });
});

router.get("/pairing/:id", requireAuth, (req: AuthedRequest, res: Response) => {
  const pairing = db.prepare(`SELECT id,status,expiresAt,targetDeviceName FROM device_pairings WHERE id = ? AND userId = ?`).get(req.params.id, req.user!.userId) as any;
  if (!pairing || new Date(pairing.expiresAt).getTime() < Date.now()) { res.status(410).json({ error: "Pairing request expired" }); return; }
  res.json({ pairingId: pairing.id, status: pairing.status, expiresAt: pairing.expiresAt, targetDeviceName: pairing.targetDeviceName });
});

export default router;
