import { db } from "../db";
import { v4 as uuidv4 } from "uuid";
import { PublicUser, UserRow, NotificationRow } from "../types";

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    bio: row.bio,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    createdAt: row.createdAt,
  };
}

// Generates a unique username from a first/last name, e.g. "Jane Doe" -> "janedoe",
// falling back to "janedoe4821" if that handle is already taken.
export function generateUsernameFrom(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15) || "user";

  let candidate = base;
  let attempt = 0;
  while (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(candidate)) {
    attempt += 1;
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    candidate = `${base}${suffix}`.slice(0, 20);
    if (attempt > 20) {
      candidate = `${base}${Date.now()}`.slice(0, 20);
      break;
    }
  }
  return candidate;
}

export function isBlocked(userId: string, otherId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM blocked_users WHERE (userId = ? AND blockedId = ?) OR (userId = ? AND blockedId = ?)`
    )
    .get(userId, otherId, otherId, userId);
  return !!row;
}

export function sanitizeString(input: unknown, maxLen = 2000): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLen);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

export function areFriends(userId: string, otherId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM friends WHERE userId = ? AND friendId = ?`)
    .get(userId, otherId);
  return !!row;
}

export function createNotification(
  userId: string,
  type: NotificationRow["type"],
  content: string,
  relatedId?: string
): NotificationRow {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO notifications (id, userId, type, content, relatedId, isRead) VALUES (?, ?, ?, ?, ?, 0)`
  ).run(id, userId, type, content, relatedId ?? null);
  return db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id) as NotificationRow;
}
