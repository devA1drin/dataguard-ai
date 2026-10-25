import { Request, Response, Router } from "express";
import crypto from "crypto";
import { config } from "../config";
import { audit } from "../lib/audit";
import { AuthUser, csrfFor, sessionUser } from "../lib/auth";
import { safeLog } from "../lib/mask";
import { classifyPendingIncidents, scorePending } from "../jobs/scorer";

/**
 * Serverless replacement for the in-process scoring timer.
 * GET/POST /api/cron/score
 *   - called by Vercel Cron with "Authorization: Bearer $CRON_SECRET", or
 *   - called manually by a signed-in security/admin user (session cookie + CSRF header).
 * Scores every unscored access event (alerts + SHAP explanations for flagged ones) and
 * asks the ML service to categorise unclassified incidents.
 */
const r = Router();

async function caller(req: Request): Promise<{ ok: boolean; actor: AuthUser | null }> {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token && config.cronSecret && token.length === config.cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.cronSecret))) return { ok: true, actor: null };
  const s = await sessionUser(req);
  if (!s) return { ok: false, actor: null };
  if (req.method !== "GET" && req.get("x-csrf-token") !== csrfFor(s.sid)) return { ok: false, actor: null };
  return { ok: s.user.role === "security" || s.user.role === "admin", actor: s.user };
}

async function run(req: Request, res: Response) {
  const c = await caller(req);
  if (!c.ok) return res.status(401).json({ error: "cron secret or a security/admin session required" });
  const t0 = Date.now();
  const scored = await scorePending();
  await classifyPendingIncidents();
  await audit({ actorId: c.actor?.id ?? null, actorRole: c.actor?.role ?? "system", action: "scoring.run", entityType: "access_log",
    ip: req.ip, details: { scored: scored.scored, done: scored.done, trigger: c.actor ? "manual" : "cron" } });
  safeLog(`cron score: ${scored.scored} events in ${Date.now() - t0}ms`);
  res.json({ ...scored, ms: Date.now() - t0 });
}

r.get("/score", run);
r.post("/score", run);
export default r;
