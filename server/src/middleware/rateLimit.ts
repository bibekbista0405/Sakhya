import rateLimit from "express-rate-limit";
import { Response } from "express";

// All limiters key on IP by default (express-rate-limit's default keyGenerator,
// which is IPv6-safe). Auth-related limiters are intentionally strict since they
// guard against credential stuffing / brute force; write-heavy social limiters are
// looser since they guard against spam rather than credential attacks.

function jsonLimitHandler(_req: unknown, res: Response) {
  res.status(429).json({ error: "Too many requests. Please try again later." });
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const accountDeletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const friendRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const sensitiveSettingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

// PINs have far lower entropy than passwords, so this is intentionally
// stricter than sensitiveSettingsLimiter — combined with the DB-backed
// exponential lockout in db/index.ts's recordChatLockAttempt.
export const chatLockVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

// A generous global fallback for every other API route, mainly to blunt
// scripted abuse / accidental client loops rather than target a specific flow.
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});
