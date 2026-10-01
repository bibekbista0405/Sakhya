import { Router, Response } from "express";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

type Visibility = "everyone" | "friends" | "nobody";
type NotificationContentLevel = "full" | "sender" | "generic" | "hidden";

const VALID_NOTIFICATION_LEVELS: NotificationContentLevel[] = ["full", "sender", "generic", "hidden"];

function ensureSettings(userId: string) {
  db.prepare(
    `INSERT INTO privacy_settings (userId)
     VALUES (?)
     ON CONFLICT(userId) DO NOTHING`
  ).run(userId);
}

function getSettings(userId: string) {
  ensureSettings(userId);
  const row = db.prepare(
    `SELECT readReceipts, typingIndicators, onlineStatus, lastSeenVisibility, notificationContentLevel
     FROM privacy_settings WHERE userId = ?`
  ).get(userId) as {
    readReceipts: number;
    typingIndicators: number;
    onlineStatus: number;
    lastSeenVisibility: Visibility;
    notificationContentLevel: NotificationContentLevel;
  };

  return {
    readReceipts: Boolean(row.readReceipts),
    typingIndicators: Boolean(row.typingIndicators),
    onlineStatus: Boolean(row.onlineStatus),
    lastSeenVisibility: row.lastSeenVisibility,
    notificationContentLevel: row.notificationContentLevel,
  };
}

router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ settings: getSettings(req.user!.userId) });
});

router.put("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const current = getSettings(userId);

  const readReceipts =
    typeof req.body?.readReceipts === "boolean" ? req.body.readReceipts : current.readReceipts;
  const typingIndicators =
    typeof req.body?.typingIndicators === "boolean"
      ? req.body.typingIndicators
      : current.typingIndicators;
  const onlineStatus =
    typeof req.body?.onlineStatus === "boolean" ? req.body.onlineStatus : current.onlineStatus;

  const requestedLevel = req.body?.notificationContentLevel;
  const notificationContentLevel: NotificationContentLevel = VALID_NOTIFICATION_LEVELS.includes(requestedLevel)
    ? requestedLevel
    : current.notificationContentLevel;

  const requestedVisibility = req.body?.lastSeenVisibility;
  const lastSeenVisibility: Visibility =
    requestedVisibility === "everyone" ||
    requestedVisibility === "friends" ||
    requestedVisibility === "nobody"
      ? requestedVisibility
      : current.lastSeenVisibility;

  db.prepare(
    `UPDATE privacy_settings
     SET readReceipts = ?, typingIndicators = ?, onlineStatus = ?,
         lastSeenVisibility = ?, notificationContentLevel = ?, updatedAt = datetime('now')
     WHERE userId = ?`
  ).run(
    readReceipts ? 1 : 0,
    typingIndicators ? 1 : 0,
    onlineStatus ? 1 : 0,
    lastSeenVisibility,
    notificationContentLevel,
    userId
  );

  res.json({ settings: getSettings(userId) });
});

export default router;
