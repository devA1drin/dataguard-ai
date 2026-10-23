import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { audit } from "../lib/audit";
import { authenticate, Role, signToken } from "../lib/auth";

const r = Router();
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

r.post("/login", async (req, res) => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "email and password required" });
  const [u] = await query<{ id: number; password_hash: string; role: Role; customer_id: number | null; full_name: string; is_active: boolean }>(
    "SELECT id, password_hash, role, customer_id, full_name, is_active FROM users WHERE lower(email)=lower($1)", [body.data.email]);
  const ok = u && u.is_active && (await bcrypt.compare(body.data.password, u.password_hash));
  if (!ok) {
    await audit({ actorId: u?.id ?? null, actorRole: null, action: "auth.login_failed", entityType: "user", entityId: u?.id, ip: req.ip,
      details: { email: body.data.email } });
    return res.status(401).json({ error: "invalid credentials" });
  }
  await query("UPDATE users SET last_login_at=now() WHERE id=$1", [u.id]);
  await audit({ actorId: u.id, actorRole: u.role, action: "auth.login", entityType: "user", entityId: u.id, ip: req.ip });
  const user = { id: u.id, role: u.role, customerId: u.customer_id, name: u.full_name };
  res.json({ token: signToken(user), user });
});

r.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

export default r;
