import crypto from "crypto";
import { CookieOptions, NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { query } from "../db";
import { clientIp, maskIp } from "./net";

/**
 * Authentication = server-side session + signed cookie.
 *  - On sign-in a row is added to `sessions`; the browser gets a JWT {sid, uid} in an
 *    httpOnly, SameSite=Strict cookie (Secure + "__Host-" prefix on HTTPS). JavaScript can't read it.
 *  - Every request re-checks the session row (revoked? expired? user still active?) and loads
 *    the CURRENT role from the database, so revocation and role changes apply immediately.
 *  - CSRF: unsafe methods need the `x-csrf-token` header (HMAC of the session id, handed to the
 *    page by /auth/me) AND, if present, an Origin header from an allowed origin.
 */
export type Role = "customer" | "dpo" | "security" | "admin" | "executive";
export const ROLES: Role[] = ["customer", "dpo", "security", "admin", "executive"];
export const STAFF_ROLES: Role[] = ["dpo", "security", "admin", "executive"];

export interface AuthUser { id: number; role: Role; customerId: number | null; name: string; email: string; mfa: boolean }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser; sessionId?: string } }
}

export const secureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : config.serverless;
export const SESSION_COOKIE = secureCookies ? "__Host-dg_session" : "dg_session";
export const sessionCookieOptions = (maxAgeMs: number): CookieOptions =>
  ({ httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/", maxAge: maxAgeMs });

export const csrfFor = (sid: string) => crypto.createHmac("sha256", config.jwtSecret).update(`csrf:${sid}`).digest("base64url");

/** Create a session row and set the cookie. Returns the CSRF token for the page. */
export async function startSession(req: Request, res: Response, userId: number, mfa: boolean): Promise<string> {
  const sid = crypto.randomUUID();
  const ms = config.sessionHours * 3600_000;
  await query("INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, mfa) VALUES ($1,$2,now() + make_interval(secs => $3),$4,$5,$6)",
    [sid, userId, ms / 1000, maskIp(clientIp(req)), (req.get("user-agent") ?? "").slice(0, 300), mfa]);
  const token = jwt.sign({ sid, uid: userId }, config.jwtSecret, { expiresIn: Math.floor(ms / 1000) });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(ms));
  return csrfFor(sid);
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(0), maxAge: undefined });
}

/** Resolve the signed-in user from the cookie, or null. */
export async function sessionUser(req: Request): Promise<{ user: AuthUser; sid: string } | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  let p: { sid: string; uid: number };
  try { p = jwt.verify(token, config.jwtSecret) as { sid: string; uid: number }; } catch { return null; }
  if (!p.sid || !/^[0-9a-f-]{36}$/.test(p.sid)) return null;
  const [row] = await query<{ id: number; role: Role; customer_id: number | null; full_name: string; email: string; mfa_enabled: boolean; stale: boolean }>(
    `SELECT u.id, u.role, u.customer_id, u.full_name, u.email, u.mfa_enabled, s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`, [p.sid, p.uid]);
  if (!row) return null;
  if (row.stale) await query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [p.sid]);
  return { sid: p.sid, user: { id: row.id, role: row.role, customerId: row.customer_id, name: row.full_name, email: row.email, mfa: row.mfa_enabled } };
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const s = await sessionUser(req);
  if (!s) return res.status(401).json({ error: "authentication required" });
  req.user = s.user;
  req.sessionId = s.sid;
  next();
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF guard for cookie-authenticated, state-changing requests (mount after authenticate). */
export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method) || !req.sessionId) return next();
  const sent = String(req.get("x-csrf-token") ?? "");
  const want = csrfFor(req.sessionId);
  if (sent.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want)))
    return res.status(403).json({ error: "missing or invalid CSRF token" });
  next();
}

/** Reject state-changing requests whose Origin isn't this site or an allowed CORS origin. */
export function originCheck(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next(); // non-browser clients (curl, cron); cookies + CSRF header still required
  const self = `${req.protocol}://${req.get("host")}`;
  const allowed = new Set([self, ...config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean)]);
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) allowed.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (!allowed.has(origin)) return res.status(403).json({ error: "cross-origin request blocked" });
  next();
}

/** Role-based access control guard. */
export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden for your role" });
  next();
};

/** Staff groups used across routes */
export const STAFF: Role[] = ["dpo", "security", "admin", "executive"];
export const REVIEWERS: Role[] = ["dpo", "security", "admin"];
