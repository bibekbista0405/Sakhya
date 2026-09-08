import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import { initDb, purgeExpiredSessions, findOrphanedAttachments, deleteAttachmentRow } from "./db";
import { initSocket, runDisappearingMessageSweep } from "./socket";
import { globalApiLimiter } from "./middleware/rateLimit";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import friendRoutes from "./routes/friends";
import messageRoutes from "./routes/messages";
import callRoutes from "./routes/calls";
import notificationRoutes from "./routes/notifications";
import profileRoutes from "./routes/profile";
import privacyRoutes from "./routes/privacy";
import deviceRoutes from "./routes/devices";
import attachmentRoutes, { ATTACHMENTS_DIR } from "./routes/attachments";
import chatLockRoutes from "./routes/chatLock";

initDb();

// Sweep expired sessions on boot, then hourly, so a stale row can never be
// used to pass the session-validity check even if a clock skew edge case slips by.
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

function purgeOrphanedAttachments(): void {
  const orphans = findOrphanedAttachments();
  for (const o of orphans) {
    fs.unlink(path.join(ATTACHMENTS_DIR, o.storagePath), () => undefined);
    deleteAttachmentRow(o.id);
  }
}
purgeOrphanedAttachments();
setInterval(purgeOrphanedAttachments, 30 * 60 * 1000).unref();

const isProduction = process.env.NODE_ENV === "production";

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("trust proxy", 1);
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(globalApiLimiter);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/chat-lock", chatLockRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Central error handler. Never leak stack traces, internal DB errors, or other
// implementation details to the client — log server-side only.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

initSocket(io);

// Disappearing-message enforcement: a periodic sweep, not a millisecond
// timer — see runDisappearingMessageSweep's doc comment for why.
runDisappearingMessageSweep();
setInterval(runDisappearingMessageSweep, 10 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`Sakhya server running on http://localhost:${PORT}`);
});
