import rateLimit from "express-rate-limit";
import { Response } from "express";

// All limiters key on IP by default (express-rate-limit's default keyGenerator,
// which is IPv6-safe). Auth-related limiters are intentionally strict since they
// guard against credential stuffing / brute force; write-heavy social limiters are
// looser since they guard against spam rather than credential attacks.
//
// Limits below are the PRODUCTION values. In any environment where
// NODE_ENV !== "production" (the default for `npm run dev`), every limit is
// multiplied by DEV_LIMIT_MULTIPLIER so a developer repeatedly registering
// test accounts, logging in, or testing the Chat Lock PIN flow from
// localhost doesn't get stuck behind an hour-long lockout meant for
// production abuse. This never weakens the limits actually enforced in
// production — only local/dev/test environments are relaxed.
const isProduction = process.env.NODE_ENV === "production";
const DEV_LIMIT_MULTIPLIER = 20;

function scaled(limit: number): number {
  return isProduction ? limit : limit * DEV_LIMIT_MULTIPLIER;
}

function jsonLimitHandler(_req: unknown, res: Response) {
  res.status(429).json({ error: "Too many requests. Please try again later." });
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scaled(10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: scaled(5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scaled(5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const accountDeletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: scaled(3),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const friendRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: scaled(30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: scaled(60),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

export const sensitiveSettingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scaled(20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

// PINs have far lower entropy than passwords, so this is intentionally
// stricter than sensitiveSettingsLimiter — combined with the DB-backed
// exponential lockout in db/index.ts's recordChatLockAttempt.
export const chatLockVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scaled(15),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});

// A generous global fallback for every other API route, mainly to blunt
// scripted abuse / accidental client loops rather than target a specific flow.
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: scaled(300),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
});
