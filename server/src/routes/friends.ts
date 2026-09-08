import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { UserRow, FriendRequestRow } from "../types";
import { toPublicUser, createNotification, isBlocked } from "../utils/helpers";
import { emitToUser, isUserOnline } from "../socket/registry";
import { friendRequestLimiter } from "../middleware/rateLimit";

const router = Router();

// List accepted friends
router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const rows = db
    .prepare(
      `SELECT u.* FROM friends f JOIN users u ON u.id = f.friendId WHERE f.userId = ? ORDER BY u.username ASC`
    )
    .all(userId) as UserRow[];
  res.json({ friends: rows.map((r) => ({ ...toPublicUser(r), online: isUserOnline(r.id) })) });
});

// Incoming + outgoing pending requests
router.get("/requests", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const incoming = db
    .prepare(
      `SELECT fr.*, u.username, u.avatar FROM friend_requests fr
       JOIN users u ON u.id = fr.senderId
       WHERE fr.receiverId = ? AND fr.status = 'pending' ORDER BY fr.createdAt DESC`
    )
    .all(userId);
  const outgoing = db
    .prepare(
      `SELECT fr.*, u.username, u.avatar FROM friend_requests fr
       JOIN users u ON u.id = fr.receiverId
       WHERE fr.senderId = ? AND fr.status = 'pending' ORDER BY fr.createdAt DESC`
    )
    .all(userId);
  res.json({ incoming, outgoing });
});

router.post("/request/:userId", requireAuth, friendRequestLimiter, (req: AuthedRequest, res: Response) => {
  const senderId = req.user!.userId;
  const receiverId = req.params.userId;

  if (senderId === receiverId) {
    res.status(400).json({ error: "You cannot add yourself" });
    return;
  }

  const receiver = db.prepare(`SELECT * FROM users WHERE id = ?`).get(receiverId) as
    | UserRow
    | undefined;
  if (!receiver) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (isBlocked(senderId, receiverId)) {
    res.status(403).json({ error: "You cannot send a request to this user" });
    return;
  }

  const alreadyFriends = db
    .prepare(`SELECT 1 FROM friends WHERE userId = ? AND friendId = ?`)
    .get(senderId, receiverId);
  if (alreadyFriends) {
    res.status(409).json({ error: "Already friends" });
    return;
  }

  const existing = db
    .prepare(
      `SELECT * FROM friend_requests WHERE
       ((senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?))
       AND status = 'pending'`
    )
    .get(senderId, receiverId, receiverId, senderId) as FriendRequestRow | undefined;
  if (existing) {
    res.status(409).json({ error: "Friend request already pending" });
    return;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO friend_requests (id, senderId, receiverId, status) VALUES (?, ?, ?, 'pending')`
  ).run(id, senderId, receiverId);

  const sender = db.prepare(`SELECT * FROM users WHERE id = ?`).get(senderId) as UserRow;
  const notif = createNotification(
    receiverId,
    "friend_request",
    `${sender.username} sent you a friend request`,
    id
  );
  emitToUser(receiverId, "friend_request", {
    request: { id, senderId, receiverId, status: "pending" },
    sender: toPublicUser(sender),
  });
  emitToUser(receiverId, "notification", notif);

  res.status(201).json({ request: { id, senderId, receiverId, status: "pending" } });
});

router.post("/accept/:requestId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const request = db
    .prepare(`SELECT * FROM friend_requests WHERE id = ?`)
    .get(req.params.requestId) as FriendRequestRow | undefined;

  if (!request || request.receiverId !== userId) {
    res.status(404).json({ error: "Friend request not found" });
    return;
  }
  if (request.status !== "pending") {
    res.status(409).json({ error: "Request already handled" });
    return;
  }

  db.prepare(`UPDATE friend_requests SET status = 'accepted' WHERE id = ?`).run(request.id);

  const f1 = uuidv4();
  const f2 = uuidv4();
  db.prepare(`INSERT OR IGNORE INTO friends (id, userId, friendId) VALUES (?, ?, ?)`).run(
    f1,
    request.senderId,
    request.receiverId
  );
  db.prepare(`INSERT OR IGNORE INTO friends (id, userId, friendId) VALUES (?, ?, ?)`).run(
    f2,
    request.receiverId,
    request.senderId
  );

  const accepter = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow;
  const notif = createNotification(
    request.senderId,
    "friend_accept",
    `${accepter.username} accepted your friend request`,
    request.id
  );
  emitToUser(request.senderId, "friend_accept", {
    requestId: request.id,
    friend: toPublicUser(accepter),
  });
  emitToUser(request.senderId, "notification", notif);

  res.json({ success: true });
});

router.post("/reject/:requestId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const request = db
    .prepare(`SELECT * FROM friend_requests WHERE id = ?`)
    .get(req.params.requestId) as FriendRequestRow | undefined;

  if (!request || request.receiverId !== userId) {
    res.status(404).json({ error: "Friend request not found" });
    return;
  }
  if (request.status !== "pending") {
    res.status(409).json({ error: "Request already handled" });
    return;
  }

  db.prepare(`UPDATE friend_requests SET status = 'rejected' WHERE id = ?`).run(request.id);
  res.json({ success: true });
});

router.delete("/:friendId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.friendId;
  db.prepare(`DELETE FROM friends WHERE userId = ? AND friendId = ?`).run(userId, friendId);
  db.prepare(`DELETE FROM friends WHERE userId = ? AND friendId = ?`).run(friendId, userId);
  res.json({ success: true });
});

// List users the current user has blocked
router.get("/blocked", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const rows = db
    .prepare(
      `SELECT u.* FROM blocked_users b JOIN users u ON u.id = b.blockedId WHERE b.userId = ? ORDER BY u.username ASC`
    )
    .all(userId) as UserRow[];
  res.json({ blocked: rows.map(toPublicUser) });
});

router.post("/block/:userId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const targetId = req.params.userId;

  if (userId === targetId) {
    res.status(400).json({ error: "You cannot block yourself" });
    return;
  }
  const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId) as
    | UserRow
    | undefined;
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Blocking removes any existing friendship and pending requests both ways.
  db.prepare(`DELETE FROM friends WHERE userId = ? AND friendId = ?`).run(userId, targetId);
  db.prepare(`DELETE FROM friends WHERE userId = ? AND friendId = ?`).run(targetId, userId);
  db.prepare(
    `DELETE FROM friend_requests WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)`
  ).run(userId, targetId, targetId, userId);

  db.prepare(
    `INSERT OR IGNORE INTO blocked_users (id, userId, blockedId) VALUES (?, ?, ?)`
  ).run(uuidv4(), userId, targetId);

  res.json({ success: true });
});

router.post("/unblock/:userId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const targetId = req.params.userId;
  db.prepare(`DELETE FROM blocked_users WHERE userId = ? AND blockedId = ?`).run(userId, targetId);
  res.json({ success: true });
});

export default router;
