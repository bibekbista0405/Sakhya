import { Router, Response } from "express";
import { db, isOnlineStatusVisible, getLastSeen, createReport } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { UserRow } from "../types";
import { toPublicUser, toPrivateUser, sanitizeString } from "../utils/helpers";
import { isUserOnline } from "../socket/registry";
import { sensitiveSettingsLimiter } from "../middleware/rateLimit";

const router = Router();

// Live search users by username, excludes self
router.get("/search", requireAuth, (req: AuthedRequest, res: Response) => {
  const q = sanitizeString(req.query.q, 50);
  if (!q) {
    res.json({ users: [] });
    return;
  }
  const rows = db
    .prepare(
      `SELECT * FROM users WHERE username LIKE ? AND id != ?
       AND id NOT IN (SELECT blockedId FROM blocked_users WHERE userId = ?)
       AND id NOT IN (SELECT userId FROM blocked_users WHERE blockedId = ?)
       ORDER BY username ASC LIMIT 20`
    )
    .all(`%${q}%`, req.user!.userId, req.user!.userId, req.user!.userId) as UserRow[];

  res.json({ users: rows.map((r) => ({ ...toPublicUser(r), online: isOnlineStatusVisible(r.id) && isUserOnline(r.id) })) });
});

router.get("/:id", requireAuth, (req: AuthedRequest, res: Response) => {
  const viewerId = req.user!.userId;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
    | UserRow
    | undefined;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const online = isOnlineStatusVisible(user.id) && isUserOnline(user.id);

  const privacyRow = db
    .prepare(`SELECT lastSeenVisibility FROM privacy_settings WHERE userId = ?`)
    .get(user.id) as { lastSeenVisibility: "everyone" | "friends" | "nobody" } | undefined;
  const visibility = privacyRow?.lastSeenVisibility ?? "friends";
  const friends =
    viewerId === user.id ||
    !!db
      .prepare(`SELECT 1 FROM friends WHERE userId = ? AND friendId = ?`)
      .get(viewerId, user.id);
  const lastSeenAllowed =
    viewerId === user.id || visibility === "everyone" || (visibility === "friends" && friends);
  const lastSeenAt = !online && lastSeenAllowed ? getLastSeen(user.id) : null;

  const serialized = viewerId === user.id ? toPrivateUser(user) : toPublicUser(user);
  res.json({ user: { ...serialized, online, lastSeenAt } });
});

const VALID_REPORT_REASONS = ["spam", "harassment", "impersonation", "inappropriate_content", "other"];

/**
 * Records a report for manual review. There is no admin/moderation UI in
 * this codebase yet — this stores the report and nothing more. Doesn't
 * require friendship (you should be able to report a stranger's account),
 * but is rate-limited since it's an easy vector for report-spam.
 */
router.post("/:id/report", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const reporterId = req.user!.userId;
  const reportedUserId = req.params.id;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
  const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : null;

  if (reportedUserId === reporterId) {
    res.status(400).json({ error: "You cannot report yourself" });
    return;
  }
  if (!VALID_REPORT_REASONS.includes(reason)) {
    res.status(400).json({ error: "Invalid report reason" });
    return;
  }
  const target = db.prepare(`SELECT id FROM users WHERE id = ?`).get(reportedUserId);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (messageId) {
    const message = db
      .prepare(`SELECT senderId, receiverId FROM messages WHERE id = ?`)
      .get(messageId) as { senderId: string; receiverId: string } | undefined;
    // A report may reference only a message that actually belongs to the
    // reporter and the reported account. This prevents using arbitrary
    // message IDs to create misleading moderation records.
    if (!message || !((message.senderId === reporterId && message.receiverId === reportedUserId) ||
      (message.senderId === reportedUserId && message.receiverId === reporterId))) {
      res.status(400).json({ error: "Invalid message for this report" });
      return;
    }
  }

  createReport(reporterId, reportedUserId, reason, messageId);
  res.status(201).json({ success: true });
});

export default router;
