import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { audit } from "../lib/audit";
import { REVIEWERS, requireRole } from "../lib/auth";
import { insertSyntheticEvents, scoreBatch } from "../jobs/scorer";

const r = Router();

r.get("/", requireRole(...REVIEWERS), async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  res.json({ logs: await query(
    `SELECT id::int AS id, ts, employee_id, employee_role, resource, hour_of_day, records_accessed, distinct_customers, off_hours,
            export_flag, failed_logins, risk_score, scored_at FROM access_logs ORDER BY ts DESC LIMIT $1`, [limit]) });
});

const Event = z.object({ employee_id: z.string().min(1), employee_role: z.enum(["support_agent", "marketing", "analyst", "it_admin", "finance"]),
  resource: z.string().min(1), customer_id: z.number().int().optional(), records_accessed: z.number().int().min(0),
  distinct_customers: z.number().int().min(0), export_flag: z.union([z.literal(0), z.literal(1)]).default(0),
  failed_logins: z.number().int().min(0).default(0), ts: z.string().datetime().optional() });

/** Ingestion endpoint: inserts events and scores them immediately (real-time path). */
r.post("/ingest", requireRole("security", "admin"), async (req, res) => {
  const b = z.array(Event).max(500).safeParse(req.body?.events);
  if (!b.success) return res.status(400).json({ error: "events[] invalid" });
  for (const e of b.data) {
    const ts = e.ts ? new Date(e.ts) : new Date();
    const hour = (ts.getUTCHours() + 8) % 24; // business runs on Philippine time (UTC+8)
    const weekend = [0, 6].includes(ts.getUTCDay()) ? 1 : 0;
    await query(
      `INSERT INTO access_logs (ts, employee_id, employee_role, resource, customer_id, hour_of_day, records_accessed,
         distinct_customers, off_hours, is_weekend, export_flag, failed_logins) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ts, e.employee_id, e.employee_role, e.resource, e.customer_id ?? null, hour, e.records_accessed, e.distinct_customers,
        hour < 7 || hour >= 20 || weekend ? 1 : 0, weekend, e.export_flag, e.failed_logins]);
  }
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "access_log.ingest", entityType: "access_log",
    ip: req.ip, details: { count: b.data.length } });
  const scored = await scoreBatch().catch(() => 0);
  res.status(201).json({ inserted: b.data.length, scored });
});

/** Demo: generate synthetic access events and score them immediately (replaces the background
 *  simulator on serverless). With suspicious=true the first event is a bulk-access pattern. */
const Sim = z.object({ count: z.number().int().min(1).max(20).default(5), suspicious: z.boolean().default(true) });
r.post("/simulate", requireRole(...REVIEWERS), async (req, res) => {
  const b = Sim.safeParse(req.body ?? {});
  if (!b.success) return res.status(400).json({ error: "count must be 1-20" });
  const before = await query<{ m: number }>("SELECT COALESCE(max(id),0)::int AS m FROM alerts");
  const suspicious = await insertSyntheticEvents(b.data.count, b.data.suspicious);
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "access_log.simulate", entityType: "access_log",
    ip: req.ip, details: { count: b.data.count, suspicious } });
  const scored = await scoreBatch();
  const alerts = await query(
    `SELECT a.id, a.risk_score, a.access_log_id::int AS access_log_id, a.explanation->>'summary' AS summary
       FROM alerts a WHERE a.id > $1 ORDER BY a.id`, [before[0].m]);
  res.status(201).json({ inserted: b.data.count, scored, new_alerts: alerts });
});

export default r;
