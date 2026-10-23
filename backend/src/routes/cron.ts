import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { audit } from "../lib/audit";
import { AuthUser } from "../lib/auth";
import { safeLog } from "../lib/mask";
import { classifyPendingIncidents, scorePending } from "../jobs/scorer";

/**
 * Serverless replacement for the in-process scoring timer.
 * GET/POST /api/cron/score
 *   - called by Vercel Cron with "Authorization: Bearer $CRON_SECRET", or
 *   - called manually by a signed-in security/admin user (JWT).
 * Scores every unscored access event (alerts + SHAP explanations for flagged ones) and
 * asks the ML service to categorise unclassified incidents.
 */
const r = Router();

function caller(req: Request): { ok: boolean; actor: AuthUser | null } {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return { ok: false, actor: null };
  if (config.cronSecret && token === config.cronSecret) return { ok: true, actor: null };
  try {
    const u = jwt.verify(token, config.jwtSecret) as AuthUser;
    return { ok: u.role === "security" || u.role === "admin", actor: u };
  } catch {
    return { ok: false, actor: null };
  }
}

async function run(req: Request, res: Response) {
  const c = caller(req);
  if (!c.ok) return res.status(401).json({ error: "cron secret or security/admin token required" });
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
