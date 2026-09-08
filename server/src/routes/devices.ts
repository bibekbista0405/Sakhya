import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { requireAuth, AuthedRequest, describeDevice } from "../middleware/auth";
import { DeviceRow, OneTimePrekeyRow, PrekeyBundle, PublicDevice } from "../types";
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
  if (existing) {
    deviceId = existing.id;
    db.prepare(
      `UPDATE devices SET name = ?, ed25519IdentityKey = ?, fallbackKeyId = ?, fallbackKey = ?, fallbackKeySignature = ?, lastActiveAt = datetime('now'), revokedAt = NULL WHERE id = ?`
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
    db.prepare(
      `INSERT INTO devices (id, userId, name, curveIdentityKey, ed25519IdentityKey, fallbackKeyId, fallbackKey, fallbackKeySignature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      deviceId,
      userId,
      deviceName,
      curveIdentityKey,
      ed25519IdentityKey,
      fallbackKeyId || null,
      fallbackKey || null,
      fallbackKeySignature || null
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

  if (targetUserId !== requesterId && !areFriends(requesterId, targetUserId)) {
    res.status(403).json({ error: "You can only establish encrypted sessions with friends" });
    return;
  }
  if (isBlocked(requesterId, targetUserId)) {
    res.status(403).json({ error: "You cannot establish a session with this user" });
    return;
  }

  const devices = db
    .prepare(`SELECT * FROM devices WHERE userId = ? AND revokedAt IS NULL ORDER BY lastActiveAt DESC`)
    .all(targetUserId) as DeviceRow[];

  const bundles: PrekeyBundle[] = devices.map((device) => {
    const otk = db
      .prepare(
        `SELECT * FROM one_time_prekeys WHERE deviceId = ? AND claimedAt IS NULL ORDER BY createdAt ASC LIMIT 1`
      )
      .get(device.id) as OneTimePrekeyRow | undefined;

    let oneTimeKey: PrekeyBundle["oneTimeKey"] = null;
    if (otk) {
      db.prepare(`UPDATE one_time_prekeys SET claimedByUserId = ?, claimedAt = datetime('now') WHERE id = ?`).run(
        requesterId,
        otk.id
      );
      oneTimeKey = { keyId: otk.keyId, publicKey: otk.publicKey };
    }

    const fallbackKey =
      !oneTimeKey && device.fallbackKey && device.fallbackKeyId && device.fallbackKeySignature
        ? { keyId: device.fallbackKeyId, publicKey: device.fallbackKey, signature: device.fallbackKeySignature }
        : null;

    return {
      deviceId: device.id,
      deviceName: device.name,
      curveIdentityKey: device.curveIdentityKey,
      ed25519IdentityKey: device.ed25519IdentityKey,
      oneTimeKey,
      fallbackKey,
    };
  });

  res.json({ userId: targetUserId, devices: bundles });
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

/** List the current account's own registered devices (crypto identity, not just login sessions). */
router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM devices WHERE userId = ? AND revokedAt IS NULL ORDER BY lastActiveAt DESC`)
    .all(req.user!.userId) as DeviceRow[];

  const remainingKeys = db
    .prepare(
      `SELECT deviceId, COUNT(*) as c FROM one_time_prekeys WHERE claimedAt IS NULL AND deviceId IN (${rows
        .map(() => "?")
        .join(",") || "''"}) GROUP BY deviceId`
    )
    .all(...rows.map((r) => r.id)) as { deviceId: string; c: number }[];
  const remainingByDevice = new Map(remainingKeys.map((r) => [r.deviceId, r.c]));

  res.json({
    devices: rows.map((r) => ({
      ...toPublicDevice(r),
      remainingOneTimeKeys: remainingByDevice.get(r.id) ?? 0,
      lowOnKeys: (remainingByDevice.get(r.id) ?? 0) < MIN_ONE_TIME_KEY_POOL_WARNING,
    })),
  });
});

/**
 * Revoke a device: marks its identity keys dead (no new sessions can be
 * established against it) and deletes any of its unclaimed one-time keys.
 * Existing Olm sessions other devices already hold are unaffected by this —
 * they must independently detect the identity-key change (Phase 3).
 */
router.delete("/:id", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const device = db.prepare(`SELECT id FROM devices WHERE id = ? AND userId = ?`).get(req.params.id, userId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  db.prepare(`UPDATE devices SET revokedAt = datetime('now') WHERE id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM one_time_prekeys WHERE deviceId = ? AND claimedAt IS NULL`).run(req.params.id);
  // Revoking the crypto device also logs out any auth session tied to it.
  db.prepare(`DELETE FROM sessions WHERE deviceId = ?`).run(req.params.id);
  res.json({ success: true });
});

export default router;
