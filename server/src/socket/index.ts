import fs from "fs";
import path from "path";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { db, purgeExpiredMessages, getDisappearingSeconds, setDisappearingSeconds, isConversationLocked } from "../db";
import { JWT_SECRET } from "../middleware/auth";
import { ATTACHMENTS_DIR } from "../routes/attachments";
import {
  AuthPayload,
  MessageRow,
  UserRow,
  AttachmentRow,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "../types";
import { onlineUsers, setIo, emitToUser, isUserOnline } from "./registry";
import { areFriends, createNotification, toPublicUser, sanitizeString, isBlocked } from "../utils/helpers";

interface AuthedSocket extends Socket {
  userId?: string;
  username?: string;
}

const activeCalls = new Map<
  string,
  { callerId: string; receiverId: string; type: "audio" | "video"; startedAt: number; connected: boolean }
>();

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏"];

// Socket.IO events bypass Express middleware entirely, so REST rate limiting
// doesn't cover "send_message". This is a minimal sliding-window limiter keyed
// per user to blunt message-spam abuse; it intentionally lives in memory since
// it only needs to survive for the lifetime of a single process/connection.
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MESSAGE_RATE_MAX = 20;
const messageRateLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = (messageRateLog.get(userId) ?? []).filter(
    (t) => now - t < MESSAGE_RATE_WINDOW_MS
  );
  if (timestamps.length >= MESSAGE_RATE_MAX) {
    messageRateLog.set(userId, timestamps);
    return true;
  }
  timestamps.push(now);
  messageRateLog.set(userId, timestamps);
  return false;
}

type StoredMessageRow = Omit<MessageRow, "reactions"> & { reactions: string };

function getMessage(id: string): MessageRow | undefined {
  const row = db
    .prepare(
      `SELECT m.*, r.content AS replyToContent, r.senderId AS replyToSenderId
       FROM messages m
       LEFT JOIN messages r ON r.id = m.replyToId
       WHERE m.id = ?`
    )
    .get(id) as StoredMessageRow | undefined;
  if (!row) return undefined;
  return { ...row, reactions: parseReactions(row.reactions) } as MessageRow;
}

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

function sendMessageToParticipants(message: MessageRow, event = "message_updated"): void {
  emitToUser(message.senderId, event, message);
  if (message.receiverId !== message.senderId) emitToUser(message.receiverId, event, message);
}

export function initSocket(io: Server): void {
  setIo(io);

  io.use((socket: AuthedSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      // Mirror the REST requireAuth check: a valid JWT signature alone isn't
      // enough, the session must still exist (i.e. not logged out / revoked).
      const session = db
        .prepare(`SELECT id, expiresAt FROM sessions WHERE token = ? AND userId = ?`)
        .get(token, payload.userId) as { id: string; expiresAt: string } | undefined;
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
        return next(new Error("Session has been revoked"));
      }
      socket.userId = payload.userId;
      socket.username = payload.username;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  // Socket.IO middleware runs only during the initial handshake. Re-check the
  // backing session for every packet so logout-all, password changes, and
  // remote session/device revocation take effect on already-open sockets too.
  io.on("connection", (socket: AuthedSocket) => {
    socket.use((_packet, next) => {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token || !socket.userId) return next(new Error("Authentication required"));
      try {
        const session = db
          .prepare(`SELECT id, expiresAt FROM sessions WHERE token = ? AND userId = ?`)
          .get(token, socket.userId) as { id: string; expiresAt: string } | undefined;
        if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
          socket.disconnect(true);
          return next(new Error("Session has been revoked"));
        }
        next();
      } catch {
        next(new Error("Authentication failed"));
      }
    });


    const userId = socket.userId!;

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socket.id);
    broadcastPresence(userId, true);
    socket.emit("online_users", { userIds: Array.from(onlineUsers.keys()) });

    socket.on(
      "send_message",
      (data: {
        receiverId: string;
        content?: string;
        replyToId?: string | null;
        ciphertext?: string;
        olmMessageType?: 0 | 1;
        senderDeviceId?: string;
        attachmentId?: string;
      }) => {
        const receiverId = data?.receiverId;
        const replyToId = typeof data?.replyToId === "string" ? data.replyToId : null;
        const attachmentId = typeof data?.attachmentId === "string" ? data.attachmentId : null;

        // Encrypted path (Phase 2): the server never sees plaintext content.
        const ciphertext = typeof data?.ciphertext === "string" ? data.ciphertext.slice(0, 20000) : null;
        const olmMessageType = data?.olmMessageType === 0 || data?.olmMessageType === 1 ? data.olmMessageType : null;
        const senderDeviceId = typeof data?.senderDeviceId === "string" ? data.senderDeviceId.slice(0, 100) : null;
        const isEncrypted = !!(ciphertext && olmMessageType !== null && senderDeviceId);

        // Legacy path: plaintext content, kept only for backward compatibility
        // during rollout. New clients should always send the encrypted fields.
        const legacyContent = isEncrypted ? "" : sanitizeString(data?.content, 4000);

        if (!receiverId || (!isEncrypted && !legacyContent)) return;
        if (isRateLimited(userId)) {
          socket.emit("error_message", { error: "You're sending messages too quickly. Please slow down." });
          return;
        }
        if (!areFriends(userId, receiverId)) {
          socket.emit("error_message", { error: "You can only message friends" });
          return;
        }
        if (isBlocked(userId, receiverId)) {
          socket.emit("error_message", { error: "You cannot message this user" });
          return;
        }

        // If this message references an attachment, it must be one this user
        // uploaded, intended for this exact receiver, and not already linked
        // to a different message (prevents replaying someone else's upload
        // or attaching the same ciphertext to multiple messages).
        if (attachmentId) {
          const attachment = db
            .prepare(`SELECT * FROM attachments WHERE id = ? AND senderId = ? AND receiverId = ? AND messageId IS NULL`)
            .get(attachmentId, userId, receiverId) as AttachmentRow | undefined;
          if (!attachment) {
            socket.emit("error_message", { error: "Invalid or already-used attachment" });
            return;
          }
        }

        if (replyToId) {
          const reply = db.prepare(`SELECT senderId, receiverId FROM messages WHERE id = ?`).get(replyToId) as
            | { senderId: string; receiverId: string }
            | undefined;
          if (!reply || !((reply.senderId === userId && reply.receiverId === receiverId) || (reply.senderId === receiverId && reply.receiverId === userId))) {
            socket.emit("error_message", { error: "Invalid reply target" });
            return;
          }
        }

        const id = uuidv4();
        const receiverOnline = isUserOnline(receiverId);
        const status: MessageRow["status"] = receiverOnline ? "delivered" : "sent";

        const disappearingSeconds = getDisappearingSeconds(userId, receiverId);
        // Computed via SQLite's own datetime(), not JS Date().toISOString():
        // the two produce different string formats ("...T...Z" vs
        // "YYYY-MM-DD HH:MM:SS"), and the expiry sweep's comparison against
        // datetime('now') is a plain string comparison — mixing formats
        // silently breaks it (an ISO 'T'/'Z' string always sorts after the
        // SQLite format, so expired rows would never match). Keeping the
        // computation in SQLite guarantees identical formatting.
        const safeSeconds = Number.isInteger(disappearingSeconds) && disappearingSeconds > 0 ? disappearingSeconds : 0;
        const expiresAtExpr = safeSeconds > 0 ? `datetime('now', '+${safeSeconds} seconds')` : "NULL";

        db.prepare(
          `INSERT INTO messages (id, senderId, receiverId, content, status, replyToId, reactions, isEncrypted, ciphertext, olmMessageType, senderDeviceId, expiresAt)
           VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ${expiresAtExpr})`
        ).run(
          id,
          userId,
          receiverId,
          legacyContent,
          status,
          replyToId,
          isEncrypted ? 1 : 0,
          ciphertext,
          olmMessageType,
          senderDeviceId
        );

        if (attachmentId) {
          db.prepare(`UPDATE attachments SET messageId = ? WHERE id = ?`).run(id, attachmentId);
        }

        const message = getMessage(id);
        if (!message) return;
        socket.emit("receive_message", message);
        emitToUser(receiverId, "receive_message", message);

        const sender = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow;
        // Never put plaintext content in a notification for an encrypted
        // message — the server cannot read it, and even if it could, doing
        // so would defeat the point of E2EE for anyone who can see notifications.
        // A conversation the RECIPIENT has locked also hides the sender's
        // name, not just the content — that's the point of locking it.
        const recipientLockedThisChat = isConversationLocked(receiverId, userId);
        const notifText = recipientLockedThisChat
          ? "New message"
          : isEncrypted
          ? `${sender.username} sent you a message`
          : `${sender.username}: ${legacyContent.slice(0, 80)}`;
        const notif = createNotification(receiverId, "message", notifText, id);
        emitToUser(receiverId, "notification", notif);
      }
    );

    socket.on(
      "edit_message",
      (data: { messageId: string; content?: string; ciphertext?: string; olmMessageType?: 0 | 1; senderDeviceId?: string }) => {
        const messageId = data?.messageId;
        const ciphertext = typeof data?.ciphertext === "string" ? data.ciphertext.slice(0, 20000) : null;
        const olmMessageType = data?.olmMessageType === 0 || data?.olmMessageType === 1 ? data.olmMessageType : null;
        const senderDeviceId = typeof data?.senderDeviceId === "string" ? data.senderDeviceId.slice(0, 100) : null;
        const isEncrypted = !!(ciphertext && olmMessageType !== null && senderDeviceId);
        const legacyContent = isEncrypted ? "" : sanitizeString(data?.content, 4000);

        if (!messageId || (!isEncrypted && !legacyContent)) return;
        const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as MessageRow | undefined;
        if (!existing || existing.senderId !== userId) return;
        if (existing.deletedAt) return;
        db.prepare(
          `UPDATE messages SET content = ?, isEncrypted = ?, ciphertext = ?, olmMessageType = ?, senderDeviceId = ?, editedAt = datetime('now') WHERE id = ?`
        ).run(legacyContent, isEncrypted ? 1 : 0, ciphertext, olmMessageType, senderDeviceId, messageId);
        const message = getMessage(messageId);
        if (message) sendMessageToParticipants(message);
      }
    );

    socket.on("delete_message", (data: { messageId: string }) => {
      const messageId = data?.messageId;
      if (!messageId) return;
      const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as MessageRow | undefined;
      if (!existing || existing.senderId !== userId) return;

      // Deleting a message also deletes any encrypted attachment it carried —
      // "delete for everyone" should remove the ciphertext blob too, not just
      // the message row that referenced it.
      const attachments = db
        .prepare(`SELECT id, storagePath FROM attachments WHERE messageId = ?`)
        .all(messageId) as { id: string; storagePath: string }[];
      for (const a of attachments) {
        fs.unlink(path.join(ATTACHMENTS_DIR, a.storagePath), () => undefined);
        db.prepare(`DELETE FROM attachments WHERE id = ?`).run(a.id);
      }

      db.prepare(
        `UPDATE messages SET content = '', ciphertext = NULL, olmMessageType = NULL, deletedAt = datetime('now'), editedAt = NULL WHERE id = ?`
      ).run(messageId);
      const message = getMessage(messageId);
      if (message) sendMessageToParticipants(message);
    });

    const ALLOWED_DISAPPEARING_SECONDS = [0, 30, 60, 300, 3600, 86400, 604800];

    socket.on("set_disappearing_timer", (data: { friendId: string; seconds: number }) => {
      const friendId = data?.friendId;
      const seconds = data?.seconds;
      if (!friendId || !ALLOWED_DISAPPEARING_SECONDS.includes(seconds)) return;
      if (!areFriends(userId, friendId)) {
        socket.emit("error_message", { error: "You can only change this setting for friends" });
        return;
      }
      setDisappearingSeconds(userId, friendId, seconds, userId);
      const payload = { friendId: userId, seconds, updatedBy: userId }; // from the recipient's point of view, "friendId" is the sender
      socket.emit("disappearing_timer_changed", { friendId, seconds, updatedBy: userId });
      emitToUser(friendId, "disappearing_timer_changed", payload);
    });

    socket.on("react_message", (data: { messageId: string; emoji: string }) => {
      const messageId = data?.messageId;
      const emoji = data?.emoji;
      if (!messageId || !ALLOWED_REACTIONS.includes(emoji)) return;
      const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as StoredMessageRow | undefined;
      if (!existing || existing.deletedAt || !((existing.senderId === userId) || (existing.receiverId === userId))) return;
      if (!areFriends(existing.senderId, existing.receiverId)) return;

      const reactions = parseReactions(existing.reactions);
      const users = new Set(reactions[emoji] || []);
      if (users.has(userId)) users.delete(userId);
      else users.add(userId);
      if (users.size) reactions[emoji] = Array.from(users);
      else delete reactions[emoji];
      db.prepare(`UPDATE messages SET reactions = ? WHERE id = ?`).run(JSON.stringify(reactions), messageId);
      const message = getMessage(messageId);
      if (message) sendMessageToParticipants(message);
    });

    socket.on("typing", (data: { receiverId: string }) => {
      if (!data?.receiverId || !areFriends(userId, data.receiverId)) return;
      const pref = db.prepare(`SELECT typingIndicators FROM privacy_settings WHERE userId = ?`).get(data.receiverId) as { typingIndicators?: number } | undefined;
      if (pref?.typingIndicators === 0) return;
      emitToUser(data.receiverId, "typing", { senderId: userId });
    });

    socket.on("stop_typing", (data: { receiverId: string }) => {
      if (!data?.receiverId || !areFriends(userId, data.receiverId)) return;
      const pref = db.prepare(`SELECT typingIndicators FROM privacy_settings WHERE userId = ?`).get(data.receiverId) as { typingIndicators?: number } | undefined;
      if (pref?.typingIndicators === 0) return;
      emitToUser(data.receiverId, "stop_typing", { senderId: userId });
    });

    socket.on("message_seen", (data: { friendId: string }) => {
      const friendId = data?.friendId;
      if (!friendId || !areFriends(userId, friendId)) return;
      const pref = db.prepare(`SELECT readReceipts FROM privacy_settings WHERE userId = ?`).get(userId) as { readReceipts?: number } | undefined;
      if (pref?.readReceipts === 0) return;
      db.prepare(
        `UPDATE messages SET status = 'seen' WHERE senderId = ? AND receiverId = ? AND status != 'seen'`
      ).run(friendId, userId);
      emitToUser(friendId, "message_seen", { by: userId });
    });

    socket.on("call_user", (data: { receiverId: string; type: "audio" | "video"; offer: RTCSessionDescriptionInit }) => {
      const { receiverId, type, offer } = data || {};
      if (!receiverId || !offer || (type !== "audio" && type !== "video")) return;
      if (!areFriends(userId, receiverId)) {
        socket.emit("error_message", { error: "You can only call friends" });
        return;
      }
      if (isBlocked(userId, receiverId)) {
        socket.emit("error_message", { error: "You cannot call this user" });
        return;
      }
      if (!isUserOnline(receiverId)) {
        socket.emit("call_failed", { reason: "User is offline" });
        return;
      }

      // Do not let a user receive/maintain multiple simultaneous calls.
      const receiverBusy = [...activeCalls.values()].some(
        (call) => call.receiverId === receiverId || call.callerId === receiverId
      );
      const callerBusy = [...activeCalls.values()].some(
        (call) => call.receiverId === userId || call.callerId === userId
      );
      if (receiverBusy) {
        socket.emit("call_failed", { reason: "User is busy on another call" });
        return;
      }
      if (callerBusy) {
        socket.emit("call_failed", { reason: "You are already on another call" });
        return;
      }

      const callId = uuidv4();
      activeCalls.set(callId, { callerId: userId, receiverId, type, startedAt: Date.now(), connected: false });
      db.prepare(`INSERT INTO calls (id, callerId, receiverId, type, status, duration) VALUES (?, ?, ?, ?, 'missed', 0)`).run(
        callId, userId, receiverId, type
      );

      const caller = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow;
      socket.emit("call_initiated", { callId, receiverId, type });
      emitToUser(receiverId, "incoming_call", { callId, type, offer, caller: toPublicUser(caller) });
      const notif = createNotification(receiverId, "incoming_call", `Incoming ${type} call from ${caller.username}`, callId);
      emitToUser(receiverId, "notification", notif);
    });

    socket.on("call_accepted", (data: { callId: string; answer: RTCSessionDescriptionInit }) => {
      const call = activeCalls.get(data?.callId);
      if (!call || call.receiverId !== userId || !data?.answer) return;
      // Acceptance only completes the WebRTC handshake. The call is marked
      // connected after RTCPeerConnection reaches the connected state.
      emitToUser(call.callerId, "call_accepted", { callId: data.callId, answer: data.answer });
    });

    socket.on("call_connected", (data: { callId: string }) => {
      const call = activeCalls.get(data?.callId);
      if (!call || (call.callerId !== userId && call.receiverId !== userId)) return;
      if (!call.connected) {
        call.connected = true;
        call.startedAt = Date.now();
        db.prepare(`UPDATE calls SET status = 'completed', startedAt = datetime('now') WHERE id = ?`).run(data.callId);
        emitToUser(call.callerId === userId ? call.receiverId : call.callerId, "call_connected", { callId: data.callId });
      }
    });

    socket.on("call_rejected", (data: { callId: string }) => {
      const call = activeCalls.get(data?.callId);
      if (!call || (call.callerId !== userId && call.receiverId !== userId)) return;
      db.prepare(`UPDATE calls SET status = 'rejected', endedAt = datetime('now') WHERE id = ?`).run(data.callId);
      emitToUser(call.callerId, "call_rejected", { callId: data.callId });
      activeCalls.delete(data.callId);
    });

    socket.on("ice_candidate", (data: { callId: string; candidate: RTCIceCandidateInit; targetId: string }) => {
      const call = activeCalls.get(data?.callId);
      if (!call || (call.callerId !== userId && call.receiverId !== userId)) return;
      const targetId = call.callerId === userId ? call.receiverId : call.callerId;
      if (data?.targetId !== targetId || !data?.candidate) return;
      emitToUser(targetId, "ice_candidate", { callId: data.callId, candidate: data.candidate });
    });

    socket.on("end_call", (data: { callId: string }) => {
      const call = activeCalls.get(data?.callId);
      if (!call || (call.callerId !== userId && call.receiverId !== userId)) return;
      const otherId = call.callerId === userId ? call.receiverId : call.callerId;
      const durationSec = call.connected ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
      const finalStatus = call.connected ? "completed" : "outgoing_cancelled";
      db.prepare(`UPDATE calls SET status = ?, duration = ?, endedAt = datetime('now') WHERE id = ?`).run(finalStatus, durationSec, data.callId);

      if (!call.connected && userId === call.callerId) {
        const caller = db.prepare(`SELECT * FROM users WHERE id = ?`).get(call.callerId) as UserRow;
        const notif = createNotification(call.receiverId, "missed_call", `Missed ${call.type} call from ${caller.username}`, data.callId);
        emitToUser(call.receiverId, "notification", notif);
      }
      emitToUser(otherId, "call_ended", { callId: data.callId, duration: durationSec });
      activeCalls.delete(data.callId);
    });

    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          broadcastPresence(userId, false);
          for (const [callId, call] of activeCalls.entries()) {
            if (call.callerId === userId || call.receiverId === userId) {
              const otherId = call.callerId === userId ? call.receiverId : call.callerId;
              const durationSec = call.connected ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
              db.prepare(`UPDATE calls SET status = ?, duration = ?, endedAt = datetime('now') WHERE id = ?`).run(
                call.connected ? "completed" : "outgoing_cancelled", durationSec, callId
              );
              emitToUser(otherId, "call_ended", { callId, duration: durationSec });
              activeCalls.delete(callId);
            }
          }
        }
      }
    });
  });
}

// Expire unanswered calls so stale signaling state cannot block future calls.
setInterval(() => {
  const now = Date.now();
  for (const [callId, call] of activeCalls.entries()) {
    if (!call.connected && now - call.startedAt > 45_000) {
      db.prepare(`UPDATE calls SET status = 'missed', endedAt = datetime('now') WHERE id = ?`).run(callId);
      emitToUser(call.callerId, "call_ended", { callId, reason: "No answer" });
      emitToUser(call.receiverId, "call_ended", { callId, reason: "No answer" });
      activeCalls.delete(callId);
    }
  }
}, 5_000);

function broadcastPresence(userId: string, online: boolean): void {
  const friends = db.prepare(`SELECT friendId FROM friends WHERE userId = ?`).all(userId) as { friendId: string }[];
  for (const f of friends) emitToUser(f.friendId, online ? "user_online" : "user_offline", { userId });
}

/**
 * Sweeps and hard-deletes messages whose disappearing-message timer has
 * elapsed (plus their attachment files), and notifies both participants so
 * an open chat removes the message immediately rather than waiting for the
 * next history fetch. Called on an interval from index.ts.
 *
 * This is a periodic sweep, not a millisecond-precise timer — enforcement
 * resolution is bounded by how often this runs (see index.ts). The client
 * also removes expired messages from its own view as soon as their local
 * countdown reaches zero, for a snappier feel, independent of this sweep.
 */
export function runDisappearingMessageSweep(): void {
  const expired = purgeExpiredMessages();
  for (const m of expired) {
    for (const storagePath of m.attachmentPaths) {
      fs.unlink(path.join(ATTACHMENTS_DIR, storagePath), () => undefined);
    }
    emitToUser(m.senderId, "message_expired", { id: m.id });
    emitToUser(m.receiverId, "message_expired", { id: m.id });
  }
}
