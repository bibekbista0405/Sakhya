import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const DB_PATH = process.env.DB_PATH || "./data/sakhya.db";
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      firstName TEXT NOT NULL DEFAULT '',
      lastName TEXT NOT NULL DEFAULT '',
      dateOfBirth TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      deviceName TEXT NOT NULL DEFAULT 'Unknown device',
      userAgent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastActiveAt TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiverId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(senderId, receiverId)
    );

    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friendId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(userId, friendId)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blockedId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(userId, blockedId)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiverId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | seen
      replyToId TEXT REFERENCES messages(id) ON DELETE SET NULL,
      reactions TEXT NOT NULL DEFAULT '{}',
      editedAt TEXT,
      deletedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      callerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiverId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- audio | video
      status TEXT NOT NULL, -- missed | completed | rejected | outgoing_cancelled
      duration INTEGER NOT NULL DEFAULT 0,
      startedAt TEXT NOT NULL DEFAULT (datetime('now')),
      endedAt TEXT
    );


    CREATE TABLE IF NOT EXISTS privacy_settings (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      readReceipts INTEGER NOT NULL DEFAULT 1,
      typingIndicators INTEGER NOT NULL DEFAULT 1,
      onlineStatus INTEGER NOT NULL DEFAULT 1,
      lastSeenVisibility TEXT NOT NULL DEFAULT 'friends',
      messagePreview INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- message | friend_request | friend_accept | missed_call | incoming_call
      content TEXT NOT NULL,
      relatedId TEXT,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(senderId, receiverId);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId);
    CREATE INDEX IF NOT EXISTS idx_calls_users ON calls(callerId, receiverId);
    CREATE INDEX IF NOT EXISTS idx_blocked_user ON blocked_users(userId);
  `);

  // Lightweight migration path for databases created before these columns existed,
  // so upgrading an existing local install doesn't require deleting data.
  const existingCols = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const migrations: [string, string][] = [
    ["firstName", "ALTER TABLE users ADD COLUMN firstName TEXT NOT NULL DEFAULT ''"],
    ["lastName", "ALTER TABLE users ADD COLUMN lastName TEXT NOT NULL DEFAULT ''"],
    ["dateOfBirth", "ALTER TABLE users ADD COLUMN dateOfBirth TEXT NOT NULL DEFAULT ''"],
    ["gender", "ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, sql] of migrations) {
    if (!existingCols.includes(col)) {
      db.exec(sql);
    }
  }

  const messageCols = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map((c) => c.name);
  const messageMigrations: [string, string][] = [
    ["replyToId", "ALTER TABLE messages ADD COLUMN replyToId TEXT REFERENCES messages(id) ON DELETE SET NULL"],
    ["reactions", "ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'"],
    ["editedAt", "ALTER TABLE messages ADD COLUMN editedAt TEXT"],
    ["deletedAt", "ALTER TABLE messages ADD COLUMN deletedAt TEXT"],
  ];
  for (const [col, sql] of messageMigrations) {
    if (!messageCols.includes(col)) {
      db.exec(sql);
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_receiver_status ON messages(receiverId, status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(replyToId);`);

  // Session/device-tracking columns, added for existing installs created before Phase 1.
  const sessionCols = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const sessionMigrations: [string, string][] = [
    ["deviceName", "ALTER TABLE sessions ADD COLUMN deviceName TEXT NOT NULL DEFAULT 'Unknown device'"],
    ["userAgent", "ALTER TABLE sessions ADD COLUMN userAgent TEXT NOT NULL DEFAULT ''"],
    ["ip", "ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''"],
    ["lastActiveAt", "ALTER TABLE sessions ADD COLUMN lastActiveAt TEXT NOT NULL DEFAULT (datetime('now'))"],
  ];
  for (const [col, sql] of sessionMigrations) {
    if (!sessionCols.includes(col)) {
      db.exec(sql);
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);`);

  // --- Phase 2: E2EE device & key management ---
  // Server stores PUBLIC key material only. Private keys never leave the client.
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Unknown device',
      curveIdentityKey TEXT NOT NULL,
      ed25519IdentityKey TEXT NOT NULL,
      fallbackKeyId TEXT,
      fallbackKey TEXT,
      fallbackKeySignature TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastActiveAt TEXT NOT NULL DEFAULT (datetime('now')),
      revokedAt TEXT,
      UNIQUE(userId, curveIdentityKey)
    );

    CREATE TABLE IF NOT EXISTS one_time_prekeys (
      id TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      keyId TEXT NOT NULL,
      publicKey TEXT NOT NULL,
      claimedByUserId TEXT REFERENCES users(id) ON DELETE SET NULL,
      claimedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(deviceId, keyId)
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(userId);
    CREATE INDEX IF NOT EXISTS idx_otk_device ON one_time_prekeys(deviceId);
    CREATE INDEX IF NOT EXISTS idx_otk_unclaimed ON one_time_prekeys(deviceId, claimedAt);
  `);

  // Link an auth session to the E2EE device it authenticated for, so revoking a
  // device (Settings → Devices) can also revoke its login session and vice versa.
  const sessionCols2 = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!sessionCols2.includes("deviceId")) {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN deviceId TEXT REFERENCES devices(id) ON DELETE SET NULL`
    );
  }

  // Mark pre-Phase-2 messages as legacy plaintext so the client can render an
  // honest "not encrypted" indicator instead of silently implying they were
  // secured. New messages are written with isEncrypted = 1 going forward.
  const messageCols2 = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const encryptionMigrations: [string, string][] = [
    ["isEncrypted", "ALTER TABLE messages ADD COLUMN isEncrypted INTEGER NOT NULL DEFAULT 0"],
    ["ciphertext", "ALTER TABLE messages ADD COLUMN ciphertext TEXT"],
    ["olmMessageType", "ALTER TABLE messages ADD COLUMN olmMessageType INTEGER"],
    ["senderDeviceId", "ALTER TABLE messages ADD COLUMN senderDeviceId TEXT"],
  ];
  for (const [col, sql] of encryptionMigrations) {
    if (!messageCols2.includes(col)) {
      db.exec(sql);
    }
  }

  // --- Phase 4: encrypted media & files ---
  // The server stores only opaque AES-GCM ciphertext bytes on disk plus this
  // bookkeeping row. It never sees the file's plaintext bytes, its
  // decryption key/IV, its real MIME type, or its filename — those travel
  // inside the Olm-encrypted message content, same as regular text messages.
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiverId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      messageId TEXT REFERENCES messages(id) ON DELETE SET NULL,
      storagePath TEXT NOT NULL,
      ciphertextSize INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      viewOnce INTEGER NOT NULL DEFAULT 0,
      consumedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(messageId);
    CREATE INDEX IF NOT EXISTS idx_attachments_sender ON attachments(senderId);
    CREATE INDEX IF NOT EXISTS idx_attachments_orphan ON attachments(messageId, createdAt);
  `);

  const attachmentCols = (db.prepare(`PRAGMA table_info(attachments)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const attachmentMigrations: [string, string][] = [
    ["viewOnce", "ALTER TABLE attachments ADD COLUMN viewOnce INTEGER NOT NULL DEFAULT 0"],
    ["consumedAt", "ALTER TABLE attachments ADD COLUMN consumedAt TEXT"],
  ];
  for (const [col, sql] of attachmentMigrations) {
    if (!attachmentCols.includes(col)) db.exec(sql);
  }

  // --- Phase 5: disappearing messages ---
  // A per-pair (not per-user) setting, same model as WhatsApp/Signal: either
  // participant can change it, and it applies going forward to new messages
  // in that conversation. userA/userB are always stored sorted so there's
  // exactly one row per pair regardless of who queries it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_settings (
      userA TEXT NOT NULL,
      userB TEXT NOT NULL,
      disappearingSeconds INTEGER NOT NULL DEFAULT 0,
      updatedBy TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (userA, userB)
    );
  `);

  const messageCols3 = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!messageCols3.includes("expiresAt")) {
    db.exec(`ALTER TABLE messages ADD COLUMN expiresAt TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expiresAt);`);

  // --- Phase 6: chat lock ---
  // One PIN per account (not per-conversation) gates access to whichever
  // conversations that account has locked — same model as WhatsApp Chat
  // Lock. Locking is a personal/local preference: only the user who locked
  // a conversation sees it as locked: the other participant's view, and
  // their ability to send messages into it, is unaffected.
  const privacyCols = (db.prepare(`PRAGMA table_info(privacy_settings)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const chatLockMigrations: [string, string][] = [
    ["chatLockPinHash", "ALTER TABLE privacy_settings ADD COLUMN chatLockPinHash TEXT"],
    ["chatLockFailedAttempts", "ALTER TABLE privacy_settings ADD COLUMN chatLockFailedAttempts INTEGER NOT NULL DEFAULT 0"],
    ["chatLockLockedUntil", "ALTER TABLE privacy_settings ADD COLUMN chatLockLockedUntil TEXT"],
  ];
  for (const [col, sql] of chatLockMigrations) {
    if (!privacyCols.includes(col)) db.exec(sql);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_locks (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friendId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lockedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (userId, friendId)
    );
  `);
}

/**
 * Finds messages whose disappearing-message timer has elapsed, along with
 * any attachment file paths that need deleting alongside them, then hard-
 * deletes those message rows. Hard delete (not a soft "deletedAt" flag) is
 * deliberate — a genuinely disappearing message should stop existing, not
 * just stop rendering.
 */
export function purgeExpiredMessages(): {
  id: string;
  senderId: string;
  receiverId: string;
  attachmentPaths: string[];
}[] {
  const expired = db
    .prepare(`SELECT id, senderId, receiverId FROM messages WHERE expiresAt IS NOT NULL AND expiresAt < datetime('now')`)
    .all() as { id: string; senderId: string; receiverId: string }[];

  const results = expired.map((m) => {
    const attachments = db
      .prepare(`SELECT storagePath FROM attachments WHERE messageId = ?`)
      .all(m.id) as { storagePath: string }[];
    db.prepare(`DELETE FROM attachments WHERE messageId = ?`).run(m.id);
    db.prepare(`DELETE FROM messages WHERE id = ?`).run(m.id);
    return { ...m, attachmentPaths: attachments.map((a) => a.storagePath) };
  });

  return results;
}

function canonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

export function getDisappearingSeconds(userId1: string, userId2: string): number {
  const [a, b] = canonicalPair(userId1, userId2);
  const row = db
    .prepare(`SELECT disappearingSeconds FROM conversation_settings WHERE userA = ? AND userB = ?`)
    .get(a, b) as { disappearingSeconds: number } | undefined;
  return row?.disappearingSeconds ?? 0;
}

export function setDisappearingSeconds(userId1: string, userId2: string, seconds: number, updatedBy: string): void {
  const [a, b] = canonicalPair(userId1, userId2);
  db.prepare(
    `INSERT INTO conversation_settings (userA, userB, disappearingSeconds, updatedBy, updatedAt)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(userA, userB) DO UPDATE SET disappearingSeconds = excluded.disappearingSeconds, updatedBy = excluded.updatedBy, updatedAt = datetime('now')`
  ).run(a, b, seconds, updatedBy);
}

// --- Phase 6: chat lock -----------------------------------------------------

interface ChatLockRow {
  chatLockPinHash: string | null;
  chatLockFailedAttempts: number;
  chatLockLockedUntil: string | null;
}

function getChatLockRow(userId: string): ChatLockRow {
  db.prepare(`INSERT INTO privacy_settings (userId) VALUES (?) ON CONFLICT(userId) DO NOTHING`).run(userId);
  return db
    .prepare(`SELECT chatLockPinHash, chatLockFailedAttempts, chatLockLockedUntil FROM privacy_settings WHERE userId = ?`)
    .get(userId) as ChatLockRow;
}

export function hasChatLockPin(userId: string): boolean {
  return !!getChatLockRow(userId).chatLockPinHash;
}

export function setChatLockPinHash(userId: string, hash: string | null): void {
  db.prepare(
    `UPDATE privacy_settings SET chatLockPinHash = ?, chatLockFailedAttempts = 0, chatLockLockedUntil = NULL WHERE userId = ?`
  ).run(hash, userId);
  if (hash === null) {
    // Removing the PIN removes the lock's whole point — unlock everything.
    db.prepare(`DELETE FROM chat_locks WHERE userId = ?`).run(userId);
  }
}

export function getChatLockPinHash(userId: string): string | null {
  return getChatLockRow(userId).chatLockPinHash;
}

/**
 * Brute-force protection for a short numeric PIN: after 5 failed attempts,
 * lock out further attempts for an exponentially growing window (capped at
 * 30 minutes). This is in addition to, not instead of, IP-based rate
 * limiting on the route itself (see middleware/rateLimit.ts) — a PIN has
 * much lower entropy than a password, so it needs both layers.
 */
export function checkChatLockLockout(userId: string): { lockedUntil: string | null } {
  const row = getChatLockRow(userId);
  // Same SQLite-datetime-format gotcha as the Phase 5 expiry bug: datetime()
  // returns "YYYY-MM-DD HH:MM:SS" (space, no zone), which needs a "T"+"Z"
  // fixup before JS Date parsing treats it as UTC instead of local time.
  if (row.chatLockLockedUntil && new Date(row.chatLockLockedUntil.replace(" ", "T") + "Z").getTime() > Date.now()) {
    return { lockedUntil: row.chatLockLockedUntil };
  }
  return { lockedUntil: null };
}

export function recordChatLockAttempt(userId: string, success: boolean): void {
  if (success) {
    db.prepare(`UPDATE privacy_settings SET chatLockFailedAttempts = 0, chatLockLockedUntil = NULL WHERE userId = ?`).run(userId);
    return;
  }
  const row = getChatLockRow(userId);
  const attempts = row.chatLockFailedAttempts + 1;
  let lockoutExpr = "NULL";
  if (attempts >= 5) {
    const tier = Math.min(Math.floor((attempts - 5) / 5), 5); // caps growth
    const minutes = Math.min(5 * 2 ** tier, 30);
    lockoutExpr = `datetime('now', '+${minutes} minutes')`;
  }
  db.prepare(
    `UPDATE privacy_settings SET chatLockFailedAttempts = ?, chatLockLockedUntil = ${lockoutExpr} WHERE userId = ?`
  ).run(attempts, userId);
}

export function lockConversation(userId: string, friendId: string): void {
  db.prepare(`INSERT OR IGNORE INTO chat_locks (userId, friendId) VALUES (?, ?)`).run(userId, friendId);
}

export function unlockConversation(userId: string, friendId: string): void {
  db.prepare(`DELETE FROM chat_locks WHERE userId = ? AND friendId = ?`).run(userId, friendId);
}

export function isConversationLocked(userId: string, friendId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM chat_locks WHERE userId = ? AND friendId = ?`).get(userId, friendId);
}

export function getLockedFriendIds(userId: string): string[] {
  return (db.prepare(`SELECT friendId FROM chat_locks WHERE userId = ?`).all(userId) as { friendId: string }[]).map(
    (r) => r.friendId
  );
}

/**
 * Deletes attachment rows (and returns their storage paths for the caller to
 * unlink from disk) that were never attached to a sent message within an
 * hour of upload — e.g. the user picked a file, the app encrypted/uploaded
 * it, then the send failed or was abandoned before the message went out.
 */
export function findOrphanedAttachments(): { id: string; storagePath: string }[] {
  return db
    .prepare(
      `SELECT id, storagePath FROM attachments WHERE messageId IS NULL AND createdAt < datetime('now', '-1 hour')`
    )
    .all() as { id: string; storagePath: string }[];
}

export function deleteAttachmentRow(id: string): void {
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
}

// Periodically purge expired sessions so revoked/expired tokens can never be reused
// even if a stray reference to them exists somewhere.
export function purgeExpiredSessions(): void {
  db.prepare(`DELETE FROM sessions WHERE expiresAt < datetime('now')`).run();
}

