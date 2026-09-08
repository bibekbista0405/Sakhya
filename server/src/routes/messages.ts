import { Router, Response } from "express";
import { db, getDisappearingSeconds, isConversationLocked } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { MessageRow, UserRow } from "../types";
import { areFriends, toPublicUser } from "../utils/helpers";
import { isUserOnline } from "../socket/registry";

const router = Router();

const MESSAGE_LIMIT = 100;

function parseReactions(value: unknown): Record<string, string[]> {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, users]) => Array.isArray(users)) as [string, string[]][]
    );
  } catch {
    return {};
  }
}

function normalizeMessage(row: MessageRow & { reactions?: unknown }): MessageRow {
  return { ...row, reactions: parseReactions(row.reactions) };
}

/**
 * Strips content from a locked conversation's preview in the chat list —
 * "avoid exposing message previews" for locked chats. Keeps only what's
 * needed to sort and render the chat-list row (timestamp, who sent it,
 * read state), never the message body or ciphertext.
 */
function redactLockedMessage(row: MessageRow | undefined): Partial<MessageRow> | null {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.senderId,
    receiverId: row.receiverId,
    status: row.status,
    createdAt: row.createdAt,
    content: "",
    ciphertext: null,
    reactions: {},
  };
}

router.get("/conversations", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;

  const friendRows = db
    .prepare(`SELECT u.* FROM friends f JOIN users u ON u.id = f.friendId WHERE f.userId = ?`)
    .all(userId) as UserRow[];

  const conversations = friendRows.map((friend) => {
    const lastMessage = db
      .prepare(
        `SELECT m.*, r.content AS replyToContent, r.senderId AS replyToSenderId
         FROM messages m
         LEFT JOIN messages r ON r.id = m.replyToId
         WHERE (m.senderId = ? AND m.receiverId = ?) OR (m.senderId = ? AND m.receiverId = ?)
         ORDER BY m.createdAt DESC LIMIT 1`
      )
      .get(userId, friend.id, friend.id, userId) as MessageRow | undefined;

    const unreadCount = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM messages
           WHERE senderId = ? AND receiverId = ? AND status != 'seen' AND deletedAt IS NULL`
        )
        .get(friend.id, userId) as { c: number }
    ).c;

    return {
      friend: { ...toPublicUser(friend), online: isUserOnline(friend.id) },
      lastMessage: isConversationLocked(userId, friend.id)
        ? redactLockedMessage(lastMessage)
        : lastMessage
        ? normalizeMessage(lastMessage)
        : null,
      unreadCount,
      isLocked: isConversationLocked(userId, friend.id),
    };
  });

  conversations.sort((a, b) => {
    const at = a.lastMessage?.createdAt ?? "";
    const bt = b.lastMessage?.createdAt ?? "";
    return bt.localeCompare(at);
  });

  res.json({ conversations });
});

router.get("/:friendId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.friendId;
  const before = typeof req.query.before === "string" ? req.query.before : null;
  const beforeId = typeof req.query.beforeId === "string" ? req.query.beforeId : null;
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 20), MESSAGE_LIMIT)
    : MESSAGE_LIMIT;

  if (!areFriends(userId, friendId)) {
    res.status(403).json({ error: "You can only view messages with friends" });
    return;
  }

  const params: (string | number)[] = [userId, friendId, friendId, userId];
  let timeClause = "";
  if (before && beforeId) {
    timeClause = " AND (m.createdAt < ? OR (m.createdAt = ? AND m.id < ?))";
    params.push(before, before, beforeId);
  } else if (before) {
    timeClause = " AND m.createdAt < ?";
    params.push(before);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT m.*, r.content AS replyToContent, r.senderId AS replyToSenderId
       FROM messages m
       LEFT JOIN messages r ON r.id = m.replyToId
       WHERE ((m.senderId = ? AND m.receiverId = ?) OR (m.senderId = ? AND m.receiverId = ?))
       ${timeClause}
       ORDER BY m.createdAt DESC, m.id DESC LIMIT ?`
    )
    .all(...params) as MessageRow[];

  const messages = rows.reverse().map(normalizeMessage);

  const privacy = db.prepare(
    `SELECT readReceipts FROM privacy_settings WHERE userId = ?`
  ).get(userId) as { readReceipts?: number } | undefined;

  // Respect the recipient's read-receipt preference. Delivery can still occur,
  // but opening a conversation should not reveal a "seen" state when disabled.
  if (privacy?.readReceipts !== 0) {
    db.prepare(
      `UPDATE messages SET status = 'seen'
       WHERE senderId = ? AND receiverId = ? AND status != 'seen'`
    ).run(friendId, userId);
  }

  res.json({
    messages,
    hasMore: rows.length === limit,
    nextBefore: rows.length === limit ? rows[rows.length - 1]?.createdAt ?? null : null,
    nextBeforeId: rows.length === limit ? rows[rows.length - 1]?.id ?? null : null,
    disappearingSeconds: getDisappearingSeconds(userId, friendId),
  });
});

export default router;
