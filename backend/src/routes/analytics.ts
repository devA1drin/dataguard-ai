import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { STAFF, requireRole } from "../lib/auth";
import { ml } from "../lib/ml";

/** Dashboard KPIs, risk forecast, model metrics and assistant - mostly proxies to the ML service. */
const r = Router();

r.get("/dashboard/kpis", requireRole(...STAFF), async (_req, res) => {
  const [k] = await query(`SELECT
     (SELECT count(*)::int FROM alerts WHERE status='flagged_for_review') AS alerts_pending,
     (SELECT count(*)::int FROM alerts WHERE status='confirmed') AS alerts_confirmed,
     (SELECT count(*)::int FROM alerts WHERE status='false_positive') AS alerts_false_positive,
     (SELECT count(*)::int FROM incidents WHERE status NOT IN ('resolved','closed')) AS incidents_open,
     (SELECT count(*)::int FROM incidents) AS incidents_total,
     (SELECT count(*)::int FROM data_requests WHERE status IN ('submitted','in_review')) AS requests_pending,
     (SELECT count(*)::int FROM data_requests WHERE status IN ('submitted','in_review') AND due_at < now()) AS requests_overdue,
     (SELECT count(*)::int FROM access_logs WHERE ts > now() - interval '24 hours') AS access_events_24h,
     (SELECT round(100.0 * avg(CASE WHEN granted THEN 1 ELSE 0 END), 1)::float FROM consents WHERE purpose='marketing_email') AS marketing_consent_rate`);
  const byCategory = await query(
    "SELECT COALESCE(final_category, predicted_category, 'unclassified') AS category, count(*)::int AS n FROM incidents GROUP BY 1 ORDER BY 2 DESC");
  res.json({ kpis: k, incidents_by_category: byCategory });
});

/** Builds daily counts from the DB and asks the ML service for trend analysis. */
r.get("/risk/forecast", requireRole(...STAFF), async (req, res) => {
  const metric = req.query.metric === "incidents" ? "incidents" : "anomalies";
  const sql = metric === "anomalies"
    // Days are Philippine calendar days; the current (incomplete) day is excluded so it doesn't drag the trend down.
    ? `SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*) FROM alerts a JOIN access_logs l ON l.id=a.access_log_id
          WHERE (l.ts AT TIME ZONE 'Asia/Manila')::date = d::date AND a.status <> 'false_positive')::int AS count
         FROM generate_series((SELECT min(ts AT TIME ZONE 'Asia/Manila')::date FROM access_logs),
                              (now() AT TIME ZONE 'Asia/Manila')::date - 1, '1 day') d`
    : `SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*) FROM incidents WHERE (reported_at AT TIME ZONE 'Asia/Manila')::date = d::date)::int AS count
         FROM generate_series((now() AT TIME ZONE 'Asia/Manila')::date - 30, (now() AT TIME ZONE 'Asia/Manila')::date - 1, '1 day') d`;
  const series = await query<{ date: string; count: number }>(sql);
  res.json({ metric, ...(await ml("/risk/forecast", { series, horizon: 14 })) });
});

r.get("/metrics", requireRole(...STAFF), async (_req, res) => res.json(await ml("/metrics")));

const Ask = z.object({ question: z.string().min(3).max(500) });
r.post("/assistant/ask", async (req, res) => {
  const b = Ask.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "question must be 3-500 chars" });
  res.json(await ml("/assistant/ask", { question: b.data.question }));
});

r.post("/ml/classify", requireRole(...STAFF), async (req, res) => res.json(await ml("/incidents/classify", { text: String(req.body?.text ?? "") })));

export default r;
