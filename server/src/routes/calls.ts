import { Router, Response } from "express";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { CallRow, UserRow } from "../types";
import { toPublicUser } from "../utils/helpers";

const router = Router();

router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const rows = db
    .prepare(
      `SELECT * FROM calls WHERE callerId = ? OR receiverId = ? ORDER BY startedAt DESC LIMIT 100`
    )
    .all(userId, userId) as CallRow[];

  const enriched = rows.map((call) => {
    const isOutgoing = call.callerId === userId;
    const otherId = isOutgoing ? call.receiverId : call.callerId;
    const other = db.prepare(`SELECT * FROM users WHERE id = ?`).get(otherId) as
      | UserRow
      | undefined;
    let direction: "incoming" | "outgoing" = isOutgoing ? "outgoing" : "incoming";
    let displayStatus: string = call.status;
    if (!isOutgoing && call.status === "outgoing_cancelled") displayStatus = "missed";
    return {
      ...call,
      direction,
      displayStatus,
      otherUser: other ? toPublicUser(other) : null,
    };
  });

  res.json({ calls: enriched });
});

export default router;
