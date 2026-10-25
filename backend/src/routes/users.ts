import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { ROLES, requireRole, STAFF_ROLES } from "../lib/auth";
import { checkPassword } from "../lib/password";

const r = Router();

// Assignee list for incident assignment (staff only, minimal fields)
r.get("/staff", requireRole("dpo", "security", "admin"), async (_req, res) => {
  res.json({ users: await query("SELECT id, full_name, role FROM users WHERE role IN ('dpo','security','admin') AND is_active ORDER BY full_name") });
});

r.use(requireRole("admin"));

r.get("/", async (_req, res) => {
  res.json({ users: await query(
    `SELECT id, email, full_name, role, customer_id, is_active, created_at, last_login_at, mfa_enabled,
            (locked_until > now()) AS locked, locked_until, failed_login_count FROM users ORDER BY id`) });
});

/** Admins create STAFF accounts (customers sign up themselves on /signup). The admin sets a
 *  temporary password that must pass the policy; the new user should change it under My security. */
const NewUser = z.object({ email: z.string().trim().toLowerCase().email(), full_name: z.string().trim().min(2).max(100),
  role: z.enum(STAFF_ROLES as [string, ...string[]]), password: z.string().min(1).max(128) });
r.post("/", async (req, res) => {
  const b = NewUser.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "Enter a name, e-mail, staff role and a temporary password." });
  const pw = checkPassword(b.data.password, b.data.email, b.data.full_name);
  if (!pw.ok) return res.status(400).json({ error: pw.problems.join(" "), problems: pw.problems });
  const [dup] = await query("SELECT 1 FROM users WHERE lower(email)=$1", [b.data.email]);
  if (dup) return res.status(409).json({ error: "A user with this e-mail already exists." });
  const hash = await bcrypt.hash(b.data.password, 12);
  const row = await tx(async (c) => {
    const ins = await c.query(
      "INSERT INTO users (email, password_hash, full_name, role, password_changed_at) VALUES ($1,$2,$3,$4,now()) RETURNING id, email, full_name, role, is_active",
      [b.data.email, hash, b.data.full_name, b.data.role]);
    await audit({ actorId: req.user!.id, actorRole: "admin", action: "user.create", entityType: "user", entityId: ins.rows[0].id,
      ip: req.ip, details: { role: b.data.role } }, c);
    return ins.rows[0];
  });
  res.status(201).json({ user: row });
});

const Upd = z.object({ role: z.enum(ROLES as [string, ...string[]]).optional(), is_active: z.boolean().optional() });
r.patch("/:id", async (req, res) => {
  const b = Upd.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid update" });
  const self = Number(req.params.id) === req.user!.id;
  if (self && (b.data.is_active === false || (b.data.role && b.data.role !== "admin")))
    return res.status(400).json({ error: "You can't deactivate or demote yourself." });
  const [cur] = await query<{ role: string }>("SELECT role FROM users WHERE id=$1", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "not found" });
  if (b.data.role && (cur.role === "customer") !== (b.data.role === "customer"))
    return res.status(400).json({ error: "Customer accounts can't be turned into staff accounts (or the reverse). Create a separate staff account." });
  const row = await tx(async (c) => {
    const u = await c.query("UPDATE users SET role=COALESCE($1,role), is_active=COALESCE($2,is_active) WHERE id=$3 RETURNING id, email, full_name, role, is_active",
      [b.data.role ?? null, b.data.is_active ?? null, req.params.id]);
    if (b.data.is_active === false) await c.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [req.params.id]);
    await audit({ actorId: req.user!.id, actorRole: "admin", action: "user.update", entityType: "user", entityId: String(req.params.id),
      ip: req.ip, details: b.data }, c);
    return u.rows[0];
  });
  res.json({ user: row });
});

r.post("/:id/unlock", async (req, res) => {
  const out = await query("UPDATE users SET locked_until=NULL, failed_login_count=0 WHERE id=$1 RETURNING id", [req.params.id]);
  if (!out.length) return res.status(404).json({ error: "not found" });
  await audit({ actorId: req.user!.id, actorRole: "admin", action: "user.unlock", entityType: "user", entityId: String(req.params.id), ip: req.ip });
  res.json({ ok: true });
});

/** Delete a LOGIN account. Records it touched are kept (links cleared); the audit log is untouched. */
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: "You can't delete your own account." });
  const ok = await tx(async (c) => {
    const u = (await c.query("SELECT id, role FROM users WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!u) return false;
    for (const [t, col] of [["consent_history", "changed_by"], ["data_requests", "handled_by"], ["alerts", "reviewed_by"], ["incidents", "reported_by"],
      ["incidents", "assigned_to"], ["incident_actions", "actor_id"]])
      await c.query(`UPDATE ${t} SET ${col}=NULL WHERE ${col}=$1`, [id]);
    await c.query("DELETE FROM users WHERE id=$1", [id]);
    await audit({ actorId: req.user!.id, actorRole: "admin", action: "user.delete", entityType: "user", entityId: id, ip: req.ip, details: { role: u.role } }, c);
    return true;
  });
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

export default r;
