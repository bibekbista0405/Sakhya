import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { UserRow } from "../types";
import { toPublicUser, sanitizeString } from "../utils/helpers";
import { passwordChangeLimiter, accountDeletionLimiter } from "../middleware/rateLimit";

const router = Router();

router.put("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const bio = sanitizeString(req.body?.bio, 300);
  const avatar = sanitizeString(req.body?.avatar, 500);
  const usernameRaw = req.body?.username;

  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as
    | UserRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let username = existing.username;
  if (typeof usernameRaw === "string" && usernameRaw.trim() && usernameRaw.trim() !== existing.username) {
    const candidate = sanitizeString(usernameRaw, 20);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(candidate)) {
      res.status(400).json({ error: "Invalid username format" });
      return;
    }
    const clash = db
      .prepare(`SELECT id FROM users WHERE username = ? AND id != ?`)
      .get(candidate, userId);
    if (clash) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    username = candidate;
  }

  const firstName =
    typeof req.body?.firstName === "string" && req.body.firstName.trim()
      ? sanitizeString(req.body.firstName, 50)
      : existing.firstName;
  const lastName =
    typeof req.body?.lastName === "string" && req.body.lastName.trim()
      ? sanitizeString(req.body.lastName, 50)
      : existing.lastName;

  db.prepare(
    `UPDATE users SET bio = ?, avatar = COALESCE(NULLIF(?, ''), avatar), username = ?, firstName = ?, lastName = ? WHERE id = ?`
  ).run(bio, avatar, username, firstName, lastName, userId);

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow;
  res.json({ user: toPublicUser(updated) });
});

router.put("/password", requireAuth, passwordChangeLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    res.status(403).json({ error: "Current password is incorrect" });
    return;
  }

  const hashed = bcrypt.hashSync(newPassword, 12);
  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hashed, userId);
  // Sensitive change: invalidate every session, including the one making this
  // request, so the user must re-authenticate everywhere with the new password.
  db.prepare(`DELETE FROM sessions WHERE userId = ?`).run(userId);

  res.json({ success: true });
});

router.delete("/", requireAuth, accountDeletionLimiter, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Require password re-entry for a destructive, irreversible action.
  if (!password || !bcrypt.compareSync(password, user.password)) {
    res.status(403).json({ error: "Password confirmation is required to delete your account" });
    return;
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  res.json({ success: true });
});

export default router;
