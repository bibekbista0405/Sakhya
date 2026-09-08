import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UAParser } from "ua-parser-js";
import { AuthPayload } from "../types";
import { db } from "../db";

// Fail hard in production if no real secret is configured. A hardcoded fallback
// secret would let anyone forge valid tokens for any account.
const isProduction = process.env.NODE_ENV === "production";
const configuredSecret = process.env.JWT_SECRET;

if (isProduction && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error(
    "JWT_SECRET must be set to a strong random value (32+ chars) in production. Refusing to start."
  );
}

export const JWT_SECRET = configuredSecret || "dev_secret_change_me_dev_only";

export interface AuthedRequest extends Request {
  user?: AuthPayload;
  sessionId?: string;
}

/**
 * Verifies the JWT AND confirms the underlying session row still exists and
 * hasn't expired. Without the session-table check, logging out (which only
 * deletes the session row) would not actually invalidate the bearer token —
 * it would remain usable until its JWT expiry, silently defeating "log out"
 * and "revoke device" for up to the full token lifetime.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }
  const token = header.slice(7);

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const session = db
    .prepare(`SELECT id, expiresAt FROM sessions WHERE token = ? AND userId = ?`)
    .get(token, payload.userId) as { id: string; expiresAt: string } | undefined;

  if (!session) {
    res.status(401).json({ error: "Session has been revoked" });
    return;
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session.id);
    res.status(401).json({ error: "Session has expired" });
    return;
  }

  // Best-effort activity heartbeat; failure here must never block the request.
  try {
    db.prepare(`UPDATE sessions SET lastActiveAt = datetime('now') WHERE id = ?`).run(session.id);
  } catch {
    // non-fatal
  }

  req.user = payload;
  req.sessionId = session.id;
  next();
}

export function signToken(payload: AuthPayload): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

/** Human-readable device label derived from the User-Agent header, e.g. "Chrome on macOS". */
export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";
  try {
    const parser = new UAParser(userAgent);
    const browser = parser.getBrowser().name;
    const os = parser.getOS().name;
    if (browser && os) return `${browser} on ${os}`;
    if (browser) return browser;
    if (os) return os;
  } catch {
    // fall through to default
  }
  return "Unknown device";
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "";
}
