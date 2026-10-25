import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { audit } from "../lib/audit";
import { STAFF_ROLES } from "../lib/auth";
import { raiseAlert } from "../lib/detect";
import { scanWebsite } from "../lib/scanner/scan";
import { BlockedError } from "../lib/scanner/ssrf";

/**
 * Website Scanner: any signed-in user pastes a URL; the backend scans the REAL live site
 * (static HTML only, SSRF-guarded, see lib/scanner/ssrf.ts) and stores the result.
 *  - Customers see only their own scans; staff (dpo, security, admin, executive) see all scans.
 *  - Every scan (and every blocked attempt) is written to the hash-chained audit log.
 *  - A "Dangerous" verdict raises a security alert for the SOC (MITRE ATT&CK T1566 Phishing).
 *  - Rate limit: SCAN_RATE_LIMIT scans per user per minute (default 10), counted from the audit log so it
 *    also works across serverless instances.
 */
const r = Router();
const LIMIT = Number(process.env.SCAN_RATE_LIMIT ?? 10);
const isStaff = (role: string) => (STAFF_ROLES as string[]).includes(role);
const Body = z.object({ url: z.string().trim().min(3).max(2048) });

r.post("/scan", async (req, res) => {
  const u = req.user!;
  const b = Body.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "Enter a web address (3-2048 characters)." });
  const [rl] = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_logs WHERE actor_id=$1 AND action LIKE 'website_scan.%' AND created_at > now() - interval '1 minute'", [u.id]);
  if (rl.n >= LIMIT) { res.set("Retry-After", "60"); return res.status(429).json({ error: `Rate limit: at most ${LIMIT} scans per minute. Please wait a moment.` }); }

  let out;
  try { out = await scanWebsite(b.data.url); } catch (e) {
    if (e instanceof BlockedError) {
      let host = ""; try { host = new URL(/^[a-z]+:/i.test(b.data.url) ? b.data.url : `https://${b.data.url}`).host; } catch { host = "(invalid)"; }
      await audit({ actorId: u.id, actorRole: u.role, action: "website_scan.blocked", entityType: "website_scan", ip: req.ip,
        details: { host: host.slice(0, 120), reason: e.message.slice(0, 200) } });
      return res.status(400).json({ error: e.message, blocked: true });
    }
    throw e;
  }
  const [row] = await query<{ id: string; created_at: string }>(
    `INSERT INTO website_scans (user_id, url, final_url, score, verdict, findings, details) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [u.id, out.url, out.final_url, out.score, out.verdict, JSON.stringify(out.findings), JSON.stringify(out.details)]);
  const host = new URL(out.final_url ?? out.url).hostname;
  // the audit trail stores the host and verdict only (query strings can contain tokens / personal data)
  await audit({ actorId: u.id, actorRole: u.role, action: "website_scan.scan", entityType: "website_scan", entityId: row.id, ip: req.ip,
    details: { host, score: out.score, verdict: out.verdict } });

  let alertId: number | null = null;
  if (out.verdict === "Dangerous") {
    const [dup] = await query("SELECT id FROM security_alerts WHERE rule='website_scan_dangerous' AND details->>'host'=$1 AND created_at > now() - interval '1 hour' LIMIT 1", [host]);
    if (!dup) {
      const top = out.findings.filter((f) => !f.positive && ["critical", "high"].includes(f.severity)).slice(0, 4).map((f) => f.title);
      const a = await raiseAlert({ rule: "website_scan_dangerous", technique: "T1566", severity: out.score >= 85 ? "critical" : "high",
        title: `Dangerous website reported by scanner: ${host}`,
        description: `Website Scanner rated ${host} ${out.score}/100 (Dangerous). ${top.length ? "Top findings: " + top.join("; ") + "." : ""} Check whether staff or customers received this link (phishing).`,
        userId: u.id, email: u.email, details: { host, scan_id: Number(row.id), score: out.score, url: out.url.slice(0, 300), findings: top } });
      alertId = a?.id ?? null;
    } else alertId = dup.id;
  }
  res.json({ scan: { id: Number(row.id), created_at: row.created_at, ...out, alert_id: alertId } });
});

r.get("/scans", async (req, res) => {
  const u = req.user!;
  const all = isStaff(u.role);
  const rows = await query(
    `SELECT s.id::int, s.created_at, s.url, s.final_url, s.score, s.verdict,
            (SELECT count(*)::int FROM jsonb_array_elements(s.findings) f WHERE NOT coalesce((f->>'positive')::boolean, false) AND f->>'severity' IN ('high','critical')) AS serious,
            ${all ? "u.full_name AS user_name, u.role AS user_role" : "NULL AS user_name, NULL AS user_role"}
       FROM website_scans s LEFT JOIN users u ON u.id = s.user_id
      WHERE ($1::boolean OR s.user_id = $2) ORDER BY s.created_at DESC LIMIT 50`, [all, u.id]);
  res.json({ scans: rows, scope: all ? "all" : "own" });
});

r.get("/scans/:id", async (req, res) => {
  const u = req.user!;
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "bad id" });
  const [row] = await query(
    `SELECT s.id::int, s.created_at, s.url, s.final_url, s.score, s.verdict, s.findings, s.details, s.user_id
       FROM website_scans s WHERE s.id = $1 AND ($2::boolean OR s.user_id = $3)`, [req.params.id, isStaff(u.role), u.id]);
  if (!row) return res.status(404).json({ error: "not found" });
  const [al] = await query("SELECT id FROM security_alerts WHERE rule='website_scan_dangerous' AND (details->>'scan_id')::bigint = $1 LIMIT 1", [row.id]);
  delete row.user_id;
  res.json({ scan: { ...row, alert_id: al?.id ?? null } });
});

export default r;
