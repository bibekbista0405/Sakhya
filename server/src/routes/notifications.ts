import { Router, Response } from "express";
import { db } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  const notifications = db
    .prepare(`SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 100`)
    .all(userId);
  res.json({ notifications });
});

router.put("/:id/read", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  db.prepare(`UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?`).run(
    req.params.id,
    userId
  );
  res.json({ success: true });
});

router.put("/read-all", requireAuth, (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;
  db.prepare(`UPDATE notifications SET isRead = 1 WHERE userId = ?`).run(userId);
  res.json({ success: true });
});

export default router;
