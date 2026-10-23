import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { REVIEWERS, requireRole } from "../lib/auth";

/** Anomaly alerts. Every alert starts as "flagged_for_review"; only a human reviewer can
 *  mark it confirmed or false_positive. */
const r = Router();
r.use(requireRole(...REVIEWERS, "executive"));

r.get("/", async (req, res) => {
  const status = (req.query.status as string) || null;
  res.json({ alerts: await query(
    `SELECT a.id, a.risk_score, a.status, a.created_at, a.reviewed_at, l.ts, l.employee_id, l.employee_role, l.resource,
            l.records_accessed, l.distinct_customers, l.export_flag, l.off_hours, l.hour_of_day,
            a.explanation->>'summary' AS summary
       FROM alerts a JOIN access_logs l ON l.id=a.access_log_id
      WHERE ($1::text IS NULL OR a.status=$1) ORDER BY l.ts DESC LIMIT 300`, [status]) });
});

/** Server-Sent Events stream of newly created alerts (token passed as ?token=). */
r.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (a: unknown) => res.write(`event: alert\ndata: ${JSON.stringify(a)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  bus.on("alert", send);
  req.on("close", () => { bus.off("alert", send); clearInterval(ping); });
});

/** Lightweight polling endpoint (used instead of SSE on serverless): newest alert id + pending count. */
r.get("/latest", async (_req, res) => {
  const [row] = await query(
    "SELECT COALESCE(max(id),0)::int AS max_id, count(*) FILTER (WHERE status='flagged_for_review')::int AS pending FROM alerts");
  res.json(row);
});

r.get("/:id", async (req, res) => {
  const [a] = await query(
    `SELECT a.*, l.ts, l.employee_id, l.employee_role, l.resource, l.hour_of_day, l.records_accessed, l.distinct_customers,
            l.off_hours, l.is_weekend, l.export_flag, l.failed_logins, u.full_name AS reviewer
       FROM alerts a JOIN access_logs l ON l.id=a.access_log_id LEFT JOIN users u ON u.id=a.reviewed_by WHERE a.id=$1`, [req.params.id]);
  if (!a) return res.status(404).json({ error: "not found" });
  res.json({ alert: a });
});

const Review = z.object({ status: z.enum(["confirmed", "false_positive", "flagged_for_review"]), note: z.string().max(2000).optional() });
r.patch("/:id/review", requireRole(...REVIEWERS), async (req, res) => {
  const b = Review.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "status must be confirmed|false_positive|flagged_for_review" });
  const row = await tx(async (c) => {
    const u = await c.query(
      "UPDATE alerts SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4 RETURNING id, status, reviewed_at",
      [b.data.status, b.data.note ?? null, req.user!.id, req.params.id]);
    if (!u.rows[0]) return null;
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "alert.review", entityType: "alert",
      entityId: String(req.params.id), ip: req.ip, details: { status: b.data.status } }, c);
    return u.rows[0];
  });
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ alert: row });
});

export default r;
