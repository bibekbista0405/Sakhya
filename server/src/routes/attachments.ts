import { Router, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { AttachmentRow } from "../types";
import { areFriends, isBlocked } from "../utils/helpers";
import rateLimit from "express-rate-limit";

const router = Router();

/**
 * The server stores and serves opaque ciphertext only. It never sees the
 * plaintext file, the AES-GCM key/IV used to decrypt it, the real MIME type,
 * or the filename — all of that travels inside the Olm-encrypted message
 * content (see client lib/attachments.ts), the same way regular text does.
 *
 * Because the server cannot read the plaintext, it CANNOT do magic-byte MIME
 * sniffing on encrypted attachments the way a normal upload endpoint should
 * for unencrypted files — the bytes are indistinguishable from random data
 * until the recipient's client decrypts them. This is an inherent trade-off
 * of true end-to-end encryption for attachments (Signal and WhatsApp accept
 * the same limitation), not an oversight. What the server CAN and does
 * enforce: authenticated, friends-only, size-capped, ownership-checked
 * upload/download, and it always serves downloads as
 * application/octet-stream regardless of any client-claimed type so browsers
 * never attempt to sniff or render ciphertext directly.
 */

const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR
  ? path.resolve(process.env.ATTACHMENTS_DIR)
  : path.resolve(__dirname, "../../data/attachments");
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

const MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB) || 25;
// AES-GCM appends a 16-byte authentication tag to the plaintext. Allow that
// small overhead so a client-side 25 MB plaintext does not get rejected as a
// 25 MB+16 B ciphertext.
const MAX_CIPHERTEXT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024 + 16;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ATTACHMENTS_DIR),
  // Random server-side filename — never trust or persist the client's
  // original filename on disk (it's encrypted/hidden from the server anyway,
  // and using it verbatim would be a path-traversal / collision risk).
  filename: (_req, _file, cb) => cb(null, uuidv4()),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_CIPHERTEXT_BYTES, files: 1 },
});

const attachmentUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res: Response) => res.status(429).json({ error: "Too many uploads. Please slow down." }),
});

router.post(
  "/",
  requireAuth,
  attachmentUploadLimiter,
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: `File too large. Maximum size is ${MAX_ATTACHMENT_MB}MB.` });
          return;
        }
        res.status(400).json({ error: "Upload failed" });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  },
  (req: AuthedRequest, res: Response) => {
    const senderId = req.user!.userId;
    const receiverId = typeof req.body?.receiverId === "string" ? req.body.receiverId : "";
    const viewOnce = req.body?.viewOnce === "true" || req.body?.viewOnce === true;
    const file = req.file;

    const cleanupAndReject = (status: number, error: string) => {
      if (file) fs.unlink(file.path, () => undefined);
      res.status(status).json({ error });
    };

    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    if (!receiverId) {
      cleanupAndReject(400, "receiverId is required");
      return;
    }
    if (receiverId === senderId) {
      cleanupAndReject(400, "Cannot upload an attachment to yourself");
      return;
    }
    if (!areFriends(senderId, receiverId)) {
      cleanupAndReject(403, "You can only send attachments to friends");
      return;
    }
    if (isBlocked(senderId, receiverId)) {
      cleanupAndReject(403, "You cannot send attachments to this user");
      return;
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO attachments (id, senderId, receiverId, storagePath, ciphertextSize, viewOnce) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, senderId, receiverId, file.filename, file.size, viewOnce ? 1 : 0);

    res.status(201).json({ attachmentId: id, ciphertextSize: file.size });
  }
);

router.get("/:id", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const attachment = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(req.params.id) as
    | AttachmentRow
    | undefined;

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  if (attachment.senderId !== userId && attachment.receiverId !== userId) {
    res.status(403).json({ error: "You do not have access to this attachment" });
    return;
  }
  if (attachment.consumedAt) {
    res.status(410).json({ error: "This media has already been viewed and is no longer available." });
    return;
  }

  const filePath = path.join(ATTACHMENTS_DIR, attachment.storagePath);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Attachment file is no longer available" });
    return;
  }

  // Always served as opaque bytes: this is ciphertext, not a renderable file,
  // and must never be sniffed/executed/displayed by the browser as anything else.
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Could not read attachment" });
    }
  });
});

/**
 * Marks a view-once attachment as consumed and immediately deletes its
 * ciphertext from disk. Only the RECEIVER can consume — "I've now viewed
 * this" is inherently a receiver action. The server cannot verify a client
 * actually rendered it (the content is encrypted, and this is a fundamental
 * limitation of enforcing view-once purely server-side for E2EE content —
 * a modified client could call this without displaying anything, or could
 * save the decrypted bytes before consuming). What this DOES guarantee:
 * once called, the ciphertext is gone from the server and no client — not
 * even the original recipient's — can download it again.
 */
router.post("/:id/consume", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const attachment = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(req.params.id) as
    | AttachmentRow
    | undefined;

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  if (attachment.receiverId !== userId) {
    res.status(403).json({ error: "Only the recipient can mark this as viewed" });
    return;
  }
  if (!attachment.viewOnce) {
    res.status(400).json({ error: "This attachment is not view-once" });
    return;
  }
  if (attachment.consumedAt) {
    res.status(410).json({ error: "Already consumed" });
    return;
  }

  // Claim the attachment atomically before deleting the blob. This closes a
  // race where two concurrent consume requests could both succeed.
  const claimed = db
    .prepare(`UPDATE attachments SET consumedAt = datetime('now') WHERE id = ? AND consumedAt IS NULL`)
    .run(attachment.id);
  if (claimed.changes !== 1) {
    res.status(410).json({ error: "Already consumed" });
    return;
  }
  fs.unlink(path.join(ATTACHMENTS_DIR, attachment.storagePath), () => undefined);
  res.json({ success: true });
});

export default router;
export { ATTACHMENTS_DIR };
