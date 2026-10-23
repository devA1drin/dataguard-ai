import { Router } from "express";
import { query } from "../db";
import { audit, verifyChain } from "../lib/audit";
import { requireRole } from "../lib/auth";

const r = Router();
r.use(requireRole("dpo", "admin", "security"));

r.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const action = (req.query.action as string) || null;
  res.json({ logs: await query(
    `SELECT a.id::int AS id, a.created_at, a.actor_id, a.actor_role, u.full_name AS actor_name, a.action, a.entity_type, a.entity_id,
            a.details, a.prev_hash, a.hash
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      WHERE ($1::text IS NULL OR a.action LIKE $1 || '%') ORDER BY a.id DESC LIMIT $2`, [action, limit]) });
});

/** Recomputes the entire hash chain to detect tampering. */
r.get("/verify", async (req, res) => {
  const result = await verifyChain();
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "audit.verify", entityType: "audit_log",
    ip: req.ip, details: { valid: result.valid, checked: result.checked } });
  res.json(result);
});

export default r;
