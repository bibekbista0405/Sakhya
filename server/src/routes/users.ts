import { Router, Response } from "express";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { UserRow } from "../types";
import { toPublicUser, sanitizeString } from "../utils/helpers";
import { isUserOnline } from "../socket/registry";

const router = Router();

// Live search users by username, excludes self
router.get("/search", requireAuth, (req: AuthedRequest, res: Response) => {
  const q = sanitizeString(req.query.q, 50);
  if (!q) {
    res.json({ users: [] });
    return;
  }
  const rows = db
    .prepare(
      `SELECT * FROM users WHERE username LIKE ? AND id != ?
       AND id NOT IN (SELECT blockedId FROM blocked_users WHERE userId = ?)
       AND id NOT IN (SELECT userId FROM blocked_users WHERE blockedId = ?)
       ORDER BY username ASC LIMIT 20`
    )
    .all(`%${q}%`, req.user!.userId, req.user!.userId, req.user!.userId) as UserRow[];

  res.json({ users: rows.map((r) => ({ ...toPublicUser(r), online: isUserOnline(r.id) })) });
});

router.get("/:id", requireAuth, (req: AuthedRequest, res: Response) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as
    | UserRow
    | undefined;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: { ...toPublicUser(user), online: isUserOnline(user.id) } });
});

export default router;
