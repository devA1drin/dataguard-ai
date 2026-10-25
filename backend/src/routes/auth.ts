import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import { config } from "../config";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { authenticate, clearSessionCookie, csrfFor, csrfProtect, Role, startSession } from "../lib/auth";
import { decrypt, encrypt, sha256 } from "../lib/crypto";
import { raiseAlert, recordAttempt } from "../lib/detect";
import { clientIp, maskIp, uaLabel } from "../lib/net";
import { checkPassword } from "../lib/password";
import { newSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { PURPOSES } from "./consents";

/**
 * /api/auth - sign-up, sign-in (+ lockout, rate limit, MFA), sessions, password, MFA management.
 * Generic errors on purpose: "invalid email or password" never says which part was wrong.
 */
const r = Router();
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-password", 10);

interface UserRow {
  id: number; email: string; password_hash: string; role: Role; customer_id: number | null; full_name: string; is_active: boolean;
  failed_login_count: number; locked_until: string | null; mfa_enabled: boolean; mfa_secret_enc: string | null; mfa_last_step: string | null;
}
const USER_COLS = "id, email, password_hash, role, customer_id, full_name, is_active, failed_login_count, locked_until, mfa_enabled, mfa_secret_enc, mfa_last_step";

const publicUser = (u: Pick<UserRow, "id" | "role" | "customer_id" | "full_name" | "email" | "mfa_enabled">) =>
  ({ id: u.id, role: u.role, customerId: u.customer_id, name: u.full_name, email: u.email, mfa: u.mfa_enabled });

const ua = (req: Request) => (req.get("user-agent") ?? "").slice(0, 300);

/** Per-IP brute-force throttle: too many failures from one (masked) IP in 15 minutes -> 429. */
async function ipThrottled(req: Request): Promise<boolean> {
  const [x] = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM login_attempts WHERE ip=$1 AND NOT success AND NOT synthetic AND ts > now() - interval '15 minutes'",
    [maskIp(clientIp(req))]);
  return x.n >= config.ipFailLimit;
}

/** Count a failure against the account; lock it after LOCK_THRESHOLD consecutive failures. */
async function countFailure(req: Request, u: UserRow, reason: string): Promise<boolean> {
  const [row] = await query<{ failed_login_count: number; locked: boolean }>(
    `UPDATE users SET failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
            locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
      WHERE id=$1 RETURNING failed_login_count, (locked_until > now()) AS locked`, [u.id, config.lockThreshold, config.lockMinutes]);
  await recordAttempt({ email: u.email, userId: u.id, ip: clientIp(req), userAgent: ua(req), success: false, reason });
  await audit({ actorId: u.id, actorRole: null, action: "auth.login_failed", entityType: "user", entityId: u.id, ip: req.ip, details: { reason } });
  const justLocked = row.locked && row.failed_login_count === 0;
  if (justLocked) {
    await audit({ actorId: u.id, actorRole: null, action: "auth.lockout", entityType: "user", entityId: u.id, ip: req.ip,
      details: { minutes: config.lockMinutes, threshold: config.lockThreshold } });
    await raiseAlert({ rule: "account_lockout", technique: "T1110", severity: "medium", title: `Account temporarily locked: ${u.email}`,
      description: `Locked for ${config.lockMinutes} minutes after ${config.lockThreshold} consecutive failed sign-ins.`,
      userId: u.id, email: u.email, ip: maskIp(clientIp(req)), details: { lock_minutes: config.lockMinutes } });
  }
  return justLocked;
}

async function completeLogin(req: Request, res: Response, u: UserRow, mfaUsed: boolean) {
  await query("UPDATE users SET last_login_at=now(), failed_login_count=0, locked_until=NULL WHERE id=$1", [u.id]);
  const csrfToken = await startSession(req, res, u.id, mfaUsed);
  await recordAttempt({ email: u.email, userId: u.id, ip: clientIp(req), userAgent: ua(req), success: true, reason: mfaUsed ? "mfa_ok" : "ok" });
  await audit({ actorId: u.id, actorRole: u.role, action: "auth.login", entityType: "user", entityId: u.id, ip: req.ip, details: { mfa: mfaUsed } });
  res.json({ user: publicUser(u), csrfToken });
}

const lockedMsg = (until: string) => {
  const mins = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));
  return `Too many failed attempts. This account is temporarily locked - try again in ${mins} minute${mins > 1 ? "s" : ""}.`;
};

// ---------------------------------------------------------------- sign-up (customers only)
const SignUp = z.object({ full_name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128) });
r.post("/signup", async (req, res) => {
  const b = SignUp.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "Enter your name, a valid e-mail and a password." });
  const { full_name, email, password } = b.data;
  const pw = checkPassword(password, email, full_name);
  if (!pw.ok) return res.status(400).json({ error: pw.problems.join(" "), problems: pw.problems, suggestions: pw.suggestions });
  const [recent] = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('auth.signup','auth.bootstrap_admin') AND ip=$1 AND created_at > now() - interval '1 hour'", [req.ip]);
  if (recent.n >= 10) return res.status(429).json({ error: "Too many sign-ups from this network. Try again later." });
  const hash = await bcrypt.hash(password, 12);
  const result = await tx(async (c) => {
    const exists = await c.query("SELECT 1 FROM users WHERE lower(email)=$1 UNION ALL SELECT 1 FROM customers WHERE lower(email)=$1", [email]);
    if (exists.rowCount) return null;
    // First-admin bootstrap: only while no admin exists, and only for ADMIN_EMAIL.
    await c.query("SELECT pg_advisory_xact_lock(732002)");
    const admins = await c.query("SELECT 1 FROM users WHERE role='admin' AND is_active LIMIT 1");
    const bootstrap = Boolean(config.adminEmail) && email === config.adminEmail && !admins.rowCount;
    let customerId: number | null = null;
    if (!bootstrap) {
      customerId = (await c.query("INSERT INTO customers (full_name, email) VALUES ($1,$2) RETURNING id", [full_name, email])).rows[0].id;
      for (const p of PURPOSES) {
        await c.query("INSERT INTO consents (customer_id, purpose, granted) VALUES ($1,$2,false)", [customerId, p]);
        await c.query("INSERT INTO consent_history (customer_id, purpose, granted, channel) VALUES ($1,$2,false,'signup')", [customerId, p]);
      }
    }
    const u = (await c.query(
      `INSERT INTO users (email, password_hash, full_name, role, customer_id, password_changed_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING ${USER_COLS}`,
      [email, hash, full_name, bootstrap ? "admin" : "customer", customerId])).rows[0] as UserRow;
    await audit({ actorId: u.id, actorRole: u.role, action: bootstrap ? "auth.bootstrap_admin" : "auth.signup", entityType: "user",
      entityId: u.id, ip: req.ip, details: { role: u.role } }, c);
    return u;
  });
  if (!result) return res.status(409).json({ error: "An account with this e-mail already exists. Try signing in instead." });
  res.status(201);
  await completeLogin(req, res, result, false);
});

// ---------------------------------------------------------------- sign-in
const Login = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) });
r.post("/login", async (req, res) => {
  const b = Login.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "email and password required" });
  const { email, password } = b.data;
  if (await ipThrottled(req)) {
    await recordAttempt({ email, userId: null, ip: clientIp(req), userAgent: ua(req), success: false, reason: "rate_limited" });
    res.set("Retry-After", "900");
    return res.status(429).json({ error: "Too many failed sign-ins from your network. Wait 15 minutes and try again." });
  }
  const [u] = await query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE lower(email)=$1`, [email]);
  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH); // same timing as a real check
    await recordAttempt({ email, userId: null, ip: clientIp(req), userAgent: ua(req), success: false, reason: "unknown_user" });
    await audit({ actorId: null, actorRole: null, action: "auth.login_failed", entityType: "user", ip: req.ip, details: { reason: "unknown_user" } });
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await recordAttempt({ email, userId: u.id, ip: clientIp(req), userAgent: ua(req), success: false, reason: "locked" });
    return res.status(423).json({ error: lockedMsg(u.locked_until), locked_until: u.locked_until });
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok || !u.is_active) {
    const locked = await countFailure(req, u, u.is_active ? "bad_password" : "inactive");
    if (locked) return res.status(423).json({ error: lockedMsg(new Date(Date.now() + config.lockMinutes * 60000).toISOString()) });
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (u.mfa_enabled) {
    const mfaToken = jwt.sign({ uid: u.id, purpose: "mfa" }, config.jwtSecret, { expiresIn: 300 });
    return res.json({ mfa_required: true, mfa_token: mfaToken });
  }
  await completeLogin(req, res, u, false);
});

const MfaVerify = z.object({ mfa_token: z.string().min(10), code: z.string().trim().min(6).max(20) });
r.post("/mfa/verify", async (req, res) => {
  const b = MfaVerify.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "code required" });
  let p: { uid: number; purpose: string };
  try { p = jwt.verify(b.data.mfa_token, config.jwtSecret) as { uid: number; purpose: string }; } catch {
    return res.status(401).json({ error: "Your sign-in step expired. Enter your password again." });
  }
  if (p.purpose !== "mfa") return res.status(401).json({ error: "invalid token" });
  const [u] = await query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [p.uid]);
  if (!u || !u.is_active || !u.mfa_enabled || !u.mfa_secret_enc) return res.status(401).json({ error: "invalid token" });
  if (u.locked_until && new Date(u.locked_until) > new Date()) return res.status(423).json({ error: lockedMsg(u.locked_until) });
  const code = b.data.code.replace(/\s/g, "");
  let good = false;
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(decrypt(u.mfa_secret_enc), code, u.mfa_last_step == null ? null : Number(u.mfa_last_step));
    if (step != null) {
      // conditional update = replay protection even under concurrent requests
      const upd = await query("UPDATE users SET mfa_last_step=$2 WHERE id=$1 AND (mfa_last_step IS NULL OR mfa_last_step < $2) RETURNING id", [u.id, step]);
      good = upd.length === 1;
    }
  } else {
    const used = await query(
      "UPDATE mfa_backup_codes SET used_at=now() WHERE id = (SELECT id FROM mfa_backup_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL LIMIT 1) RETURNING id",
      [u.id, sha256(code.toUpperCase().replace(/-/g, ""))]);
    good = used.length === 1;
    if (good) await audit({ actorId: u.id, actorRole: u.role, action: "auth.mfa_backup_code_used", entityType: "user", entityId: u.id, ip: req.ip });
  }
  if (!good) {
    const locked = await countFailure(req, u, "mfa_failed");
    if (locked) return res.status(423).json({ error: lockedMsg(new Date(Date.now() + config.lockMinutes * 60000).toISOString()) });
    return res.status(401).json({ error: "That code is not valid. Check your authenticator app and try again." });
  }
  await completeLogin(req, res, u, true);
});

// ---------------------------------------------------------------- signed-in routes
r.use(authenticate, csrfProtect);

r.get("/me", (req, res) => res.json({ user: req.user, csrfToken: csrfFor(req.sessionId!) }));

r.post("/logout", async (req, res) => {
  await query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [req.sessionId]);
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.logout", entityType: "session", entityId: req.sessionId, ip: req.ip });
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.get("/sessions", async (req, res) => {
  const rows = await query<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; mfa: boolean }>(
    `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent, mfa FROM sessions
      WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [req.user!.id]);
  res.json({ sessions: rows.map((s) => ({ ...s, device: uaLabel(s.user_agent), current: s.id === req.sessionId })) });
});

r.delete("/sessions/:id", async (req, res) => {
  const out = await query("UPDATE sessions SET revoked_at=now() WHERE id::text=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id", [req.params.id, req.user!.id]);
  if (!out.length) return res.status(404).json({ error: "session not found" });
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.session_revoke", entityType: "session", entityId: String(req.params.id), ip: req.ip });
  if (req.params.id === req.sessionId) clearSessionCookie(res);
  res.json({ ok: true });
});

r.post("/sessions/revoke-others", async (req, res) => {
  const out = await query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id", [req.user!.id, req.sessionId]);
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.session_revoke_others", entityType: "session", ip: req.ip, details: { revoked: out.length } });
  res.json({ revoked: out.length });
});

r.get("/login-history", async (req, res) => {
  res.json({ attempts: await query(
    `SELECT id, ts, ip, user_agent, success, reason, country, city, threat_match FROM login_attempts
      WHERE user_id=$1 ORDER BY ts DESC LIMIT 50`, [req.user!.id]) });
});

const PwChange = z.object({ current_password: z.string().min(1), new_password: z.string().min(1).max(128) });
r.post("/password", async (req, res) => {
  const b = PwChange.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "current and new password required" });
  const [u] = await query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [req.user!.id]);
  if (!(await bcrypt.compare(b.data.current_password, u.password_hash))) return res.status(400).json({ error: "Current password is wrong." });
  const pw = checkPassword(b.data.new_password, u.email, u.full_name);
  if (!pw.ok) return res.status(400).json({ error: pw.problems.join(" "), problems: pw.problems });
  await query("UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1", [u.id, await bcrypt.hash(b.data.new_password, 12)]);
  const out = await query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id", [u.id, req.sessionId]);
  await audit({ actorId: u.id, actorRole: u.role, action: "auth.password_change", entityType: "user", entityId: u.id, ip: req.ip, details: { other_sessions_revoked: out.length } });
  res.json({ ok: true, other_sessions_revoked: out.length });
});

// ---------------------------------------------------------------- MFA (TOTP + backup codes)
r.get("/mfa", async (req, res) => {
  const [x] = await query<{ mfa_enabled: boolean; remaining: number }>(
    "SELECT u.mfa_enabled, (SELECT count(*)::int FROM mfa_backup_codes b WHERE b.user_id=u.id AND b.used_at IS NULL) AS remaining FROM users u WHERE u.id=$1",
    [req.user!.id]);
  res.json({ enabled: x.mfa_enabled, backup_codes_remaining: x.remaining });
});

r.post("/mfa/setup", async (req, res) => {
  if (req.user!.mfa) return res.status(400).json({ error: "MFA is already on. Turn it off first to enrol a new device." });
  const secret = newSecret();
  await query("UPDATE users SET mfa_pending_enc=$2 WHERE id=$1", [req.user!.id, encrypt(secret)]);
  const uri = otpauthUri(secret, req.user!.email);
  res.json({ secret, otpauth_uri: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

function newBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 10 }, () => {
    const s = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { plain, hashes: plain.map((c) => sha256(c.replace("-", ""))) };
}

r.post("/mfa/enable", async (req, res) => {
  const code = String(req.body?.code ?? "").replace(/\s/g, "");
  const [u] = await query<{ mfa_pending_enc: string | null }>("SELECT mfa_pending_enc FROM users WHERE id=$1", [req.user!.id]);
  if (!u?.mfa_pending_enc) return res.status(400).json({ error: "Start the setup first." });
  const secret = decrypt(u.mfa_pending_enc);
  const step = verifyTotp(secret, code, null);
  if (step == null) return res.status(400).json({ error: "That code doesn't match. Make sure your phone's clock is correct and try again." });
  const { plain, hashes } = newBackupCodes();
  await tx(async (c) => {
    await c.query("UPDATE users SET mfa_enabled=true, mfa_secret_enc=$2, mfa_pending_enc=NULL, mfa_last_step=$3 WHERE id=$1", [req.user!.id, encrypt(secret), step]);
    await c.query("DELETE FROM mfa_backup_codes WHERE user_id=$1", [req.user!.id]);
    for (const h of hashes) await c.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1,$2)", [req.user!.id, h]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.mfa_enable", entityType: "user", entityId: req.user!.id, ip: req.ip }, c);
  });
  res.json({ enabled: true, backup_codes: plain });
});

const MfaOff = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20) });
async function checkPasswordAndCode(req: Request): Promise<string | null> {
  const b = MfaOff.safeParse(req.body);
  if (!b.success) return "password and current code required";
  const [u] = await query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [req.user!.id]);
  if (!u.mfa_enabled || !u.mfa_secret_enc) return "MFA is not enabled";
  if (!(await bcrypt.compare(b.data.password, u.password_hash))) return "Password is wrong.";
  if (verifyTotp(decrypt(u.mfa_secret_enc), b.data.code.replace(/\s/g, ""), u.mfa_last_step == null ? null : Number(u.mfa_last_step)) == null)
    return "Authenticator code is wrong.";
  return null;
}

r.post("/mfa/disable", async (req, res) => {
  const err = await checkPasswordAndCode(req);
  if (err) return res.status(400).json({ error: err });
  await tx(async (c) => {
    await c.query("UPDATE users SET mfa_enabled=false, mfa_secret_enc=NULL, mfa_pending_enc=NULL, mfa_last_step=NULL WHERE id=$1", [req.user!.id]);
    await c.query("DELETE FROM mfa_backup_codes WHERE user_id=$1", [req.user!.id]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.mfa_disable", entityType: "user", entityId: req.user!.id, ip: req.ip }, c);
  });
  res.json({ enabled: false });
});

r.post("/mfa/backup-codes", async (req, res) => {
  const err = await checkPasswordAndCode(req);
  if (err) return res.status(400).json({ error: err });
  const { plain, hashes } = newBackupCodes();
  await tx(async (c) => {
    await c.query("DELETE FROM mfa_backup_codes WHERE user_id=$1", [req.user!.id]);
    for (const h of hashes) await c.query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1,$2)", [req.user!.id, h]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "auth.mfa_backup_codes_regenerate", entityType: "user", entityId: req.user!.id, ip: req.ip }, c);
  });
  res.json({ backup_codes: plain });
});

export default r;
