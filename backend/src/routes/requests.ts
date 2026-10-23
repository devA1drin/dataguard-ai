import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { requireRole } from "../lib/auth";

/** Data subject rights requests (access / correction / deletion). */
const r = Router();

// Customer view: internal fields (handled_by, internal_note) are deliberately NOT selected.
const CUSTOMER_FIELDS = "reference, type, details, status, response, created_at, updated_at, due_at";

r.get("/me", requireRole("customer"), async (req, res) => {
  res.json({ requests: await query(`SELECT ${CUSTOMER_FIELDS} FROM data_requests WHERE customer_id=$1 ORDER BY created_at DESC`, [req.user!.customerId]) });
});

const NewReq = z.object({ type: z.enum(["access", "correction", "deletion"]), details: z.string().min(5).max(2000) });
r.post("/", requireRole("customer"), async (req, res) => {
  const b = NewReq.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "type must be access|correction|deletion and details 5-2000 chars" });
  const row = await tx(async (c) => {
    const seq = await c.query("SELECT count(*)::int + 1 AS n FROM data_requests");
    const ref = `DR-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(4, "0")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const ins = await c.query(`INSERT INTO data_requests (reference, customer_id, type, details) VALUES ($1,$2,$3,$4) RETURNING id, ${CUSTOMER_FIELDS}`,
      [ref, req.user!.customerId, b.data.type, b.data.details]);
    await audit({ actorId: req.user!.id, actorRole: "customer", action: "data_request.create", entityType: "data_request",
      entityId: ins.rows[0].id, ip: req.ip, details: { reference: ref, type: b.data.type } }, c);
    const { id, ...pub } = ins.rows[0];
    return pub;
  });
  res.status(201).json({ request: row });
});

// Staff (DPO/admin) view
r.get("/", requireRole("dpo", "admin"), async (_req, res) => {
  res.json({ requests: await query(
    `SELECT d.id, d.reference, d.type, d.details, d.status, d.response, d.internal_note, d.created_at, d.updated_at, d.due_at,
            d.customer_id, u.full_name AS handled_by_name
       FROM data_requests d LEFT JOIN users u ON u.id=d.handled_by ORDER BY d.created_at DESC`) });
});

const Upd = z.object({ status: z.enum(["submitted", "in_review", "completed", "rejected"]).optional(),
  response: z.string().max(2000).optional(), internal_note: z.string().max(2000).optional() });
r.patch("/:id", requireRole("dpo", "admin"), async (req, res) => {
  const b = Upd.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid body" });
  const out = await tx(async (c) => {
    const u = await c.query(
      `UPDATE data_requests SET status=COALESCE($1,status), response=COALESCE($2,response), internal_note=COALESCE($3,internal_note),
              handled_by=$4, updated_at=now() WHERE id=$5 RETURNING id, reference, status`,
      [b.data.status ?? null, b.data.response ?? null, b.data.internal_note ?? null, req.user!.id, req.params.id]);
    if (!u.rows[0]) return null;
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "data_request.update", entityType: "data_request",
      entityId: String(req.params.id), ip: req.ip, details: { status: b.data.status, responded: !!b.data.response } }, c);
    return u.rows[0];
  });
  if (!out) return res.status(404).json({ error: "not found" });
  res.json({ request: out });
});

export default r;
