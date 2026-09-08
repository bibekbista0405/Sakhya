import { Router, Response } from "express";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

type Visibility = "everyone" | "friends" | "nobody";

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
    `SELECT readReceipts, typingIndicators, onlineStatus, lastSeenVisibility, messagePreview
     FROM privacy_settings WHERE userId = ?`
  ).get(userId) as {
    readReceipts: number;
    typingIndicators: number;
    onlineStatus: number;
    lastSeenVisibility: Visibility;
    messagePreview: number;
  };

  return {
    readReceipts: Boolean(row.readReceipts),
    typingIndicators: Boolean(row.typingIndicators),
    onlineStatus: Boolean(row.onlineStatus),
    lastSeenVisibility: row.lastSeenVisibility,
    messagePreview: Boolean(row.messagePreview),
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
  const messagePreview =
    typeof req.body?.messagePreview === "boolean"
      ? req.body.messagePreview
      : current.messagePreview;

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
         lastSeenVisibility = ?, messagePreview = ?, updatedAt = datetime('now')
     WHERE userId = ?`
  ).run(
    readReceipts ? 1 : 0,
    typingIndicators ? 1 : 0,
    onlineStatus ? 1 : 0,
    lastSeenVisibility,
    messagePreview ? 1 : 0,
    userId
  );

  res.json({ settings: getSettings(userId) });
});

export default router;
