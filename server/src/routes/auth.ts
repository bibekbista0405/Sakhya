import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { signToken, requireAuth, AuthedRequest, describeDevice, clientIp } from "../middleware/auth";
import { UserRow } from "../types";
import {
  toPublicUser,
  isValidEmail,
  isValidUsername,
  sanitizeString,
  generateUsernameFrom,
} from "../utils/helpers";
import { loginLimiter, registerLimiter } from "../middleware/rateLimit";

const router = Router();

const VALID_GENDERS = ["male", "female", "custom", "prefer_not_to_say", ""];
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function createSession(userId: string, token: string, req: AuthedRequest): void {
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  const userAgent = sanitizeString(req.headers["user-agent"] as string | undefined, 300);
  const deviceName = describeDevice(userAgent);
  const ip = clientIp(req);
  db.prepare(
    `INSERT INTO sessions (id, userId, token, deviceName, userAgent, ip, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, token, deviceName, userAgent, ip, expiresAt);
}

router.post("/register", registerLimiter, (req, res: Response) => {
  const firstName = sanitizeString(req.body?.firstName, 50);
  const lastName = sanitizeString(req.body?.lastName, 50);
  const dateOfBirth = sanitizeString(req.body?.dateOfBirth, 10);
  const genderRaw = sanitizeString(req.body?.gender, 20).toLowerCase();
  const email = sanitizeString(req.body?.email, 100).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  // Kept for backward compatibility with API clients that still send a username directly.
  const explicitUsername = sanitizeString(req.body?.username, 20);

  if (!firstName || !lastName) {
    res.status(400).json({ error: "First and last name are required" });
    return;
  }
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  if (genderRaw && !VALID_GENDERS.includes(genderRaw)) {
    res.status(400).json({ error: "Invalid gender value" });
    return;
  }
  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    res.status(400).json({ error: "Invalid date of birth format" });
    return;
  }

  let username = explicitUsername;
  if (username && !isValidUsername(username)) {
    res.status(400).json({ error: "Username must be 3-20 characters (letters, numbers, underscore)" });
    return;
  }
  if (!username) {
    username = generateUsernameFrom(firstName, lastName);
  }

  const existing = db
    .prepare(`SELECT id FROM users WHERE email = ? OR username = ?`)
    .get(email, username);
  if (existing) {
    res.status(409).json({ error: "Username or email already in use" });
    return;
  }

  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`;

  db.prepare(
    `INSERT INTO users (id, username, email, password, avatar, bio, firstName, lastName, dateOfBirth, gender)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, username, email, hashed, avatar, "", firstName, lastName, dateOfBirth, genderRaw);

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow;
  const token = signToken({ userId: user.id, username: user.username });
  createSession(user.id, token, req as AuthedRequest);

  res.status(201).json({ user: toPublicUser(user), token });
});

router.post("/login", loginLimiter, (req, res: Response) => {
  const email = sanitizeString(req.body?.email, 100).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  // Always run bcrypt.compareSync even on a missing user (against a dummy hash) so
  // response timing doesn't reveal whether an email is registered.
  const passwordHash = user?.password ?? "$2a$12$invalidsaltinvalidsaltinvalidsal.invalidhashinvalidhashinval";
  const valid = bcrypt.compareSync(password, passwordHash);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username });
  createSession(user.id, token, req as AuthedRequest);

  res.json({ user: toPublicUser(user), token });
});

router.post("/logout", requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(req.sessionId);
  res.json({ success: true });
});

// Revoke every session for this account except the one making the request.
router.post("/logout-all", requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM sessions WHERE userId = ? AND id != ?`).run(
    req.user!.userId,
    req.sessionId
  );
  res.json({ success: true });
});

// List active devices/sessions for the current account.
router.get("/sessions", requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT id, deviceName, ip, createdAt, lastActiveAt, expiresAt FROM sessions
       WHERE userId = ? ORDER BY lastActiveAt DESC`
    )
    .all(req.user!.userId) as {
    id: string;
    deviceName: string;
    ip: string;
    createdAt: string;
    lastActiveAt: string;
    expiresAt: string;
  }[];

  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      deviceName: r.deviceName,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
      expiresAt: r.expiresAt,
      isCurrent: r.id === req.sessionId,
    })),
  });
});

// Revoke a specific device/session (e.g. "log out this device remotely").
router.delete("/sessions/:id", requireAuth, (req: AuthedRequest, res: Response) => {
  const session = db
    .prepare(`SELECT id FROM sessions WHERE id = ? AND userId = ?`)
    .get(req.params.id, req.user!.userId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

router.get("/me", requireAuth, (req: AuthedRequest, res: Response) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.userId) as
    | UserRow
    | undefined;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: toPublicUser(user) });
});

export default router;
