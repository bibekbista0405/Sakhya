import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { sensitiveSettingsLimiter, chatLockVerifyLimiter } from "../middleware/rateLimit";
import { areFriends } from "../utils/helpers";
import {
  hasChatLockPin,
  getChatLockPinHash,
  setChatLockPinHash,
  checkChatLockLockout,
  recordChatLockAttempt,
  lockConversation,
  unlockConversation,
  getLockedFriendIds,
} from "../db";

const router = Router();

function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin);
}

router.get("/status", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  res.json({ hasPin: hasChatLockPin(userId), lockedFriendIds: getLockedFriendIds(userId) });
});

/** Sets a new PIN, or changes an existing one (requires the current PIN). */
router.post("/pin", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { pin, currentPin } = req.body ?? {};

  if (!isValidPin(pin)) {
    res.status(400).json({ error: "PIN must be 4-8 digits" });
    return;
  }

  const existingHash = getChatLockPinHash(userId);
  if (existingHash) {
    if (typeof currentPin !== "string" || !bcrypt.compareSync(currentPin, existingHash)) {
      res.status(403).json({ error: "Current PIN is incorrect" });
      return;
    }
  }

  const hash = bcrypt.hashSync(pin, 12);
  setChatLockPinHash(userId, hash);
  res.json({ success: true });
});

/** Removes the PIN entirely, which also unlocks every conversation for this user. */
router.delete("/pin", requireAuth, sensitiveSettingsLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { pin } = req.body ?? {};
  const existingHash = getChatLockPinHash(userId);
  if (!existingHash) {
    res.status(400).json({ error: "No PIN is set" });
    return;
  }
  if (typeof pin !== "string" || !bcrypt.compareSync(pin, existingHash)) {
    res.status(403).json({ error: "Incorrect PIN" });
    return;
  }
  setChatLockPinHash(userId, null);
  res.json({ success: true });
});

/**
 * Verifies a PIN to grant temporary client-side access to locked
 * conversations. This does NOT change any lock state server-side — "is this
 * chat visible right now" is a client-held, in-memory decision (see
 * lib/chatLock.ts on the client) that resets on reload. This endpoint only
 * answers "is this the right PIN," with brute-force protection.
 */
router.post("/verify", requireAuth, chatLockVerifyLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { pin } = req.body ?? {};

  const lockout = checkChatLockLockout(userId);
  if (lockout.lockedUntil) {
    res.status(429).json({ error: "Too many incorrect attempts. Please try again later.", lockedUntil: lockout.lockedUntil });
    return;
  }

  const hash = getChatLockPinHash(userId);
  if (!hash) {
    res.status(400).json({ error: "No PIN is set" });
    return;
  }
  if (!isValidPin(pin)) {
    recordChatLockAttempt(userId, false);
    res.status(400).json({ valid: false });
    return;
  }

  const valid = bcrypt.compareSync(pin, hash);
  recordChatLockAttempt(userId, valid);
  res.json({ valid });
});

router.post("/lock/:friendId", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.friendId;
  if (!hasChatLockPin(userId)) {
    res.status(400).json({ error: "Set a Chat Lock PIN before locking a conversation" });
    return;
  }
  if (!areFriends(userId, friendId)) {
    res.status(403).json({ error: "You can only lock conversations with friends" });
    return;
  }
  lockConversation(userId, friendId);
  res.json({ success: true });
});

/** Unlocking (removing the lock, not just viewing) requires re-entering the PIN. */
router.post("/unlock/:friendId", requireAuth, chatLockVerifyLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.friendId;
  const { pin } = req.body ?? {};

  const lockout = checkChatLockLockout(userId);
  if (lockout.lockedUntil) {
    res.status(429).json({ error: "Too many incorrect attempts. Please try again later.", lockedUntil: lockout.lockedUntil });
    return;
  }

  const hash = getChatLockPinHash(userId);
  if (!hash || typeof pin !== "string" || !bcrypt.compareSync(pin, hash)) {
    recordChatLockAttempt(userId, false);
    res.status(403).json({ error: "Incorrect PIN" });
    return;
  }
  recordChatLockAttempt(userId, true);
  unlockConversation(userId, friendId);
  res.json({ success: true });
});

export default router;
