import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit, verifyChain } from "../lib/audit";
import { REVIEWERS, requireRole } from "../lib/auth";
import { recordAttempt } from "../lib/detect";

/** Security Operations Centre API (security / dpo / admin only). */
const r = Router();
r.use(requireRole(...REVIEWERS));

const band = (s: number) => (s >= 0.9 ? "critical" : s >= 0.75 ? "high" : s >= 0.6 ? "medium" : "low");

/**
 * Posture score 0-100 = weighted average of transparent checks (each 0-100). The page lists
 * every component so the number is explainable, not a black box.
 */
r.get("/overview", async (_req, res) => {
  const [c] = await query(`SELECT
    (SELECT count(*)::int FROM users WHERE role <> 'customer' AND is_active) AS staff,
    (SELECT count(*)::int FROM users WHERE role <> 'customer' AND is_active AND mfa_enabled) AS staff_mfa,
    (SELECT count(*)::int FROM users WHERE is_active) AS users,
    (SELECT count(*)::int FROM users WHERE is_active AND mfa_enabled) AS users_mfa,
    (SELECT count(*)::int FROM users WHERE locked_until > now()) AS locked,
    (SELECT count(*)::int FROM security_alerts WHERE status='flagged_for_review' AND severity IN ('high','critical')) AS open_high,
    (SELECT count(*)::int FROM security_alerts WHERE created_at > now() - interval '30 days') AS sa_30,
    (SELECT count(*)::int FROM security_alerts WHERE created_at > now() - interval '30 days' AND status <> 'flagged_for_review') AS sa_30_reviewed,
    (SELECT count(*)::int FROM alerts WHERE created_at > now() - interval '30 days') AS ml_30,
    (SELECT count(*)::int FROM alerts WHERE created_at > now() - interval '30 days' AND status <> 'flagged_for_review') AS ml_30_reviewed,
    (SELECT count(*)::int FROM login_attempts WHERE threat_match IS NOT NULL AND ts > now() - interval '24 hours') AS threat_24h,
    (SELECT count(*)::int FROM login_attempts WHERE ts > now() - interval '24 hours') AS attempts_24h,
    (SELECT count(*)::int FROM login_attempts WHERE NOT success AND ts > now() - interval '24 hours') AS failed_24h,
    (SELECT count(*)::int FROM incidents WHERE personal_data_breach AND npc_notified_at IS NULL) AS breaches_unnotified`);
  const chain = await verifyChain();
  const reviewedTotal = c.sa_30 + c.ml_30;
  const comps = [
    { key: "mfa", label: "Staff accounts with MFA", weight: 25, value: c.staff ? Math.round((100 * c.staff_mfa) / c.staff) : 0,
      detail: `${c.staff_mfa} of ${c.staff} staff accounts`, tip: "Ask every staff member to turn on MFA under My security." },
    { key: "review", label: "Alerts reviewed (30 days)", weight: 20,
      value: reviewedTotal ? Math.round((100 * (c.sa_30_reviewed + c.ml_30_reviewed)) / reviewedTotal) : 100,
      detail: `${c.sa_30_reviewed + c.ml_30_reviewed} of ${reviewedTotal} alerts`, tip: "Review flagged alerts on the Alerts and Threats pages." },
    { key: "open_high", label: "No open high/critical security alerts", weight: 20, value: Math.max(0, 100 - 20 * c.open_high),
      detail: `${c.open_high} open`, tip: "Investigate and close high/critical alerts first." },
    { key: "chain", label: "Audit log hash chain intact", weight: 15, value: chain.valid ? 100 : 0,
      detail: chain.valid ? `${chain.checked} rows verified` : `broken at row ${chain.brokenAtId}`, tip: "A broken chain means the audit log was altered - escalate immediately." },
    { key: "locked", label: "No accounts currently locked", weight: 10, value: c.locked ? Math.max(0, 100 - 25 * c.locked) : 100,
      detail: `${c.locked} locked`, tip: "Locked accounts can mean an active brute-force attack. Check the Threats page." },
    { key: "threat", label: "No sign-ins from listed IPs (24 h)", weight: 10, value: Math.max(0, 100 - 10 * c.threat_24h),
      detail: `${c.threat_24h} attempts`, tip: "Block listed IP ranges at the firewall/WAF." },
  ];
  const score = Math.round(comps.reduce((s, x) => s + x.weight * x.value, 0) / comps.reduce((s, x) => s + x.weight, 0));

  const sev = await query<{ severity: string; n: number }>(
    "SELECT severity, count(*)::int AS n FROM security_alerts WHERE status='flagged_for_review' GROUP BY 1");
  const mlOpen = await query<{ risk_score: number }>("SELECT risk_score FROM alerts WHERE status='flagged_for_review'");
  const bySeverity = ["critical", "high", "medium", "low"].map((s) => ({
    severity: s, security: sev.find((x) => x.severity === s)?.n ?? 0, ml: mlOpen.filter((a) => band(a.risk_score) === s).length }));

  const daily = await query(
    `WITH d AS (SELECT generate_series(((now() AT TIME ZONE 'Asia/Manila')::date - 13), (now() AT TIME ZONE 'Asia/Manila')::date, interval '1 day')::date AS day)
     SELECT to_char(d.day,'YYYY-MM-DD') AS day,
            count(a.id) FILTER (WHERE NOT a.success)::int AS failed, count(a.id) FILTER (WHERE a.success)::int AS ok
       FROM d LEFT JOIN login_attempts a ON (a.ts AT TIME ZONE 'Asia/Manila')::date = d.day GROUP BY d.day ORDER BY d.day`);
  const topUsers = await query(
    `WITH a AS (SELECT lower(email) AS email, count(*) FILTER (WHERE NOT success)::int AS failed, count(*) FILTER (WHERE success)::int AS ok
                 FROM login_attempts WHERE ts > now() - interval '14 days' GROUP BY lower(email))
     SELECT a.*, (SELECT count(*)::int FROM security_alerts s WHERE lower(s.email)=a.email AND s.created_at > now() - interval '14 days') AS alerts
       FROM a ORDER BY alerts DESC, failed DESC LIMIT 8`);
  const topIps = await query(
    `SELECT ip, count(*) FILTER (WHERE NOT success)::int AS failed, count(DISTINCT lower(email))::int AS accounts,
            max(threat_match) AS threat, max(country) AS country
       FROM login_attempts WHERE ts > now() - interval '14 days' GROUP BY ip HAVING count(*) FILTER (WHERE NOT success) > 0
      ORDER BY failed DESC LIMIT 8`);
  res.json({ posture: { score, grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F", components: comps },
    counts: c, by_severity: bySeverity, daily, top_users: topUsers, top_ips: topIps });
});

/** Live feed for polling: newest sign-in attempts, security alerts and ML alerts, merged. */
r.get("/feed", async (_req, res) => {
  const items = await query(
    `(SELECT 'login' AS kind, a.id::text AS id, a.ts AS at, CASE WHEN a.success THEN 'low' ELSE 'medium' END AS severity,
             (CASE WHEN a.success THEN 'Sign-in OK: ' ELSE 'Sign-in failed (' || coalesce(a.reason,'?') || '): ' END) || a.email AS title,
             a.ip || ' · ' || coalesce(a.city,'?') || coalesce(' · listed: ' || a.threat_match, '') AS detail, NULL AS technique_id
        FROM login_attempts a ORDER BY a.ts DESC LIMIT 25)
     UNION ALL
     (SELECT 'security_alert', s.id::text, s.created_at, s.severity, s.title, s.description, s.technique_id
        FROM security_alerts s ORDER BY s.created_at DESC LIMIT 15)
     UNION ALL
     (SELECT 'ml_alert', a.id::text, a.created_at,
             CASE WHEN a.risk_score >= 0.9 THEN 'critical' WHEN a.risk_score >= 0.75 THEN 'high' WHEN a.risk_score >= 0.6 THEN 'medium' ELSE 'low' END,
             'Access anomaly: ' || l.employee_id || ' (' || l.employee_role || ')', coalesce(a.explanation->>'summary', ''),
             CASE WHEN l.export_flag = 1 THEN 'T1567' ELSE 'T1213' END
        FROM alerts a JOIN access_logs l ON l.id = a.access_log_id ORDER BY a.created_at DESC LIMIT 10)
     ORDER BY at DESC LIMIT 40`);
  res.json({ items, server_time: new Date().toISOString() });
});

r.get("/security-alerts", async (req, res) => {
  const status = (req.query.status as string) || null;
  res.json({ alerts: await query(
    `SELECT s.id, s.created_at, s.rule, s.technique_id, s.severity, s.title, s.description, s.email, s.ip, s.details, s.status,
            s.reviewed_at, s.review_note, s.synthetic, u.full_name AS reviewer
       FROM security_alerts s LEFT JOIN users u ON u.id = s.reviewed_by
      WHERE ($1::text IS NULL OR s.status=$1) ORDER BY s.created_at DESC LIMIT 200`, [status]) });
});

const Review = z.object({ status: z.enum(["confirmed", "false_positive", "flagged_for_review"]), note: z.string().max(2000).optional() });
r.patch("/security-alerts/:id/review", async (req, res) => {
  const b = Review.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "status must be confirmed|false_positive|flagged_for_review" });
  const row = await tx(async (c) => {
    const u = await c.query("UPDATE security_alerts SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4 RETURNING id, status",
      [b.data.status, b.data.note ?? null, req.user!.id, req.params.id]);
    if (!u.rows[0]) return null;
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "security_alert.review", entityType: "security_alert",
      entityId: String(req.params.id), ip: req.ip, details: { status: b.data.status } }, c);
    return u.rows[0];
  });
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ alert: row });
});

r.get("/login-attempts", async (req, res) => {
  const result = req.query.result === "failed" ? false : req.query.result === "success" ? true : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase()}%` : null;
  res.json({ attempts: await query(
    `SELECT id, ts, email, ip, user_agent, success, reason, country, city, threat_match, synthetic FROM login_attempts
      WHERE ($1::boolean IS NULL OR success=$1) AND ($2::text IS NULL OR lower(email) LIKE $2 OR ip LIKE $2)
      ORDER BY ts DESC LIMIT 200`, [result, q]) });
});

r.get("/threat-intel", async (_req, res) => {
  res.json({ indicators: await query(
    `SELECT t.*, (SELECT count(*)::int FROM login_attempts a WHERE a.ip = t.indicator OR (position('/' in t.indicator) > 0 AND a.ip ~ '^[0-9.]+$' AND a.ip::inet <<= t.indicator::cidr)) AS hits
       FROM threat_intel t ORDER BY confidence DESC`),
    note: "SAMPLE data: synthetic indicators in the RFC 5737 documentation range (192.0.2.0/24). Not a real blocklist." });
});

/** Training/demo: simulate a brute-force attack from a listed IP against a NON-EXISTENT account, so no real
 *  user is ever locked out. Rows are marked synthetic. */
r.post("/simulate/brute-force", requireRole("security", "admin"), async (req, res) => {
  const target = "victim.simulated@dataguard.example";
  for (let i = 0; i < 6; i++)
    await recordAttempt({ email: target, userId: null, ip: "192.0.2.13", userAgent: "Mozilla/5.0 (compatible; Hydra) [SIMULATED]",
      success: false, reason: "unknown_user", synthetic: true });
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "simulation.brute_force", entityType: "security_alert", ip: req.ip,
    details: { attempts: 6, source_ip: "192.0.2.13" } });
  const [alert] = await query("SELECT id, title, technique_id, severity FROM security_alerts WHERE rule='brute_force' AND email=$1 ORDER BY id DESC LIMIT 1", [target]);
  res.json({ attempts: 6, alert: alert ?? null });
});

export default r;
