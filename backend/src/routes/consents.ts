import { Router } from "express";
import { z } from "zod";
import { tx, query } from "../db";
import { audit } from "../lib/audit";
import { requireRole } from "../lib/auth";

/** Customer-facing consent management. Responses only contain fields the customer needs. */
const r = Router();
export const PURPOSES = ["marketing_email", "sms_promotions", "personalized_recommendations", "third_party_sharing", "analytics"] as const;

r.use(requireRole("customer"));

r.get("/me", async (req, res) => {
  const rows = await query("SELECT purpose, granted, updated_at FROM consents WHERE customer_id=$1 ORDER BY purpose", [req.user!.customerId]);
  res.json({ consents: rows });
});

r.get("/me/history", async (req, res) => {
  const rows = await query(
    "SELECT purpose, granted, channel, changed_at FROM consent_history WHERE customer_id=$1 ORDER BY changed_at DESC LIMIT 200",
    [req.user!.customerId]);
  res.json({ history: rows });
});

const Body = z.object({ granted: z.boolean() });
r.put("/me/:purpose", async (req, res) => {
  const purpose = String(req.params.purpose);
  const b = Body.safeParse(req.body);
  if (!PURPOSES.includes(purpose as any) || !b.success) return res.status(400).json({ error: "invalid purpose or body" });
  const cid = req.user!.customerId!;
  const out = await tx(async (c) => {
    const row = await c.query(
      `INSERT INTO consents (customer_id, purpose, granted, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (customer_id, purpose) DO UPDATE SET granted=EXCLUDED.granted, updated_at=now()
       RETURNING purpose, granted, updated_at`, [cid, purpose, b.data.granted]);
    await c.query("INSERT INTO consent_history (customer_id, purpose, granted, channel, changed_by) VALUES ($1,$2,$3,'portal',$4)",
      [cid, purpose, b.data.granted, req.user!.id]);
    await audit({ actorId: req.user!.id, actorRole: "customer", action: b.data.granted ? "consent.grant" : "consent.withdraw",
      entityType: "consent", entityId: `${cid}:${purpose}`, ip: req.ip, details: { purpose, granted: b.data.granted } }, c);
    return row.rows[0];
  });
  res.json({ consent: out });
});

export default r;
