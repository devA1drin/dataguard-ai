import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { audit } from "../lib/audit";
import { REVIEWERS, requireRole } from "../lib/auth";
import { ml } from "../lib/ml";

/** Phishing detector (ML service). Only a hash of the submitted text is stored - never the text itself. */
const r = Router();
r.use(requireRole(...REVIEWERS));
const Body = z.object({ kind: z.enum(["url", "email"]), text: z.string().trim().min(4).max(20000) });
r.post("/analyze", async (req, res) => {
  const b = Body.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "kind (url|email) and text (4-20000 chars) required" });
  const out = await ml<{ probability: number; label: string; model: string }>("/phishing/analyze", b.data);
  const digest = crypto.createHash("sha256").update(b.data.text).digest("hex").slice(0, 16);
  await query("INSERT INTO model_predictions (model_name, entity_type, entity_id, output) VALUES ($1,'phishing_check',$2,$3)",
    [out.model, digest, { probability: out.probability, label: out.label, kind: b.data.kind }]);
  await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "phishing.analyze", entityType: "phishing_check", entityId: digest,
    ip: req.ip, details: { kind: b.data.kind, label: out.label, probability: Math.round(out.probability * 1000) / 1000 } });
  res.json(out);
});
export default r;
