import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { ROLES, requireRole } from "../lib/auth";

const r = Router();

// Assignee list for incident assignment (staff only, minimal fields)
r.get("/staff", requireRole("dpo", "security", "admin"), async (_req, res) => {
  res.json({ users: await query("SELECT id, full_name, role FROM users WHERE role IN ('dpo','security','admin') AND is_active ORDER BY full_name") });
});

r.use(requireRole("admin"));

r.get("/", async (_req, res) => {
  res.json({ users: await query("SELECT id, email, full_name, role, customer_id, is_active, created_at, last_login_at FROM users ORDER BY id") });
});

const NewUser = z.object({ email: z.string().email(), full_name: z.string().min(2), role: z.enum(ROLES as [string, ...string[]]),
  password: z.string().min(10), customer_id: z.number().int().optional() });
r.post("/", async (req, res) => {
  const b = NewUser.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid user (password min 10 chars)" });
  const hash = await bcrypt.hash(b.data.password, 10);
  const row = await tx(async (c) => {
    const ins = await c.query(
      "INSERT INTO users (email, password_hash, full_name, role, customer_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role, is_active",
      [b.data.email, hash, b.data.full_name, b.data.role, b.data.customer_id ?? null]);
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
  if (Number(req.params.id) === req.user!.id && b.data.is_active === false) return res.status(400).json({ error: "cannot deactivate yourself" });
  const row = await tx(async (c) => {
    const u = await c.query("UPDATE users SET role=COALESCE($1,role), is_active=COALESCE($2,is_active) WHERE id=$3 RETURNING id, email, full_name, role, is_active",
      [b.data.role ?? null, b.data.is_active ?? null, req.params.id]);
    if (!u.rows[0]) return null;
    await audit({ actorId: req.user!.id, actorRole: "admin", action: "user.update", entityType: "user", entityId: String(req.params.id),
      ip: req.ip, details: b.data }, c);
    return u.rows[0];
  });
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ user: row });
});

export default r;
