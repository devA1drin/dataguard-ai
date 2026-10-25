import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db";
import { audit } from "../lib/audit";
import { REVIEWERS, STAFF, requireRole } from "../lib/auth";
import { ml } from "../lib/ml";
import { safeLog } from "../lib/mask";
import { NPC_HOURS, playbookFor } from "../lib/playbooks";

const r = Router();
const STATUSES = ["open", "investigating", "contained", "resolved", "closed"] as const;
const CATEGORIES = ["unauthorized_access", "data_leak", "phishing", "misconfiguration", "policy_violation", "lost_device"] as const;

r.get("/", requireRole(...STAFF), async (req, res) => {
  const status = req.query.status as string | undefined;
  res.json({ incidents: await query(
    `SELECT i.id, i.title, i.severity, i.status, i.predicted_category, i.category_confidence, i.final_category,
            i.personal_data_breach, i.breach_discovered_at, i.npc_notified_at,
            i.reported_at, i.updated_at, a.full_name AS assignee
       FROM incidents i LEFT JOIN users a ON a.id=i.assigned_to
      WHERE ($1::text IS NULL OR i.status=$1) ORDER BY i.reported_at DESC`, [status ?? null]) });
});

r.get("/:id", requireRole(...STAFF), async (req, res) => {
  const [inc] = await query(
    `SELECT i.*, a.full_name AS assignee, rp.full_name AS reporter FROM incidents i
       LEFT JOIN users a ON a.id=i.assigned_to LEFT JOIN users rp ON rp.id=i.reported_by WHERE i.id=$1`, [req.params.id]);
  if (!inc) return res.status(404).json({ error: "not found" });
  const actions = await query(
    `SELECT x.id, x.action_type, x.content, x.completed, x.created_at, u.full_name AS actor
       FROM incident_actions x LEFT JOIN users u ON u.id=x.actor_id WHERE incident_id=$1 ORDER BY x.created_at`, [req.params.id]);
  const [pred] = await query(
    "SELECT output FROM model_predictions WHERE entity_type='incident' AND entity_id=$1 ORDER BY id DESC LIMIT 1", [req.params.id]);
  res.json({ incident: inc, actions, classification: pred?.output ?? null });
});

const NewInc = z.object({ title: z.string().min(3).max(200), description: z.string().min(10).max(5000),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"), related_alert_id: z.number().int().optional() });
r.post("/", requireRole(...REVIEWERS), async (req, res) => {
  const b = NewInc.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid incident" });
  let cls: any = null;
  try { cls = await ml("/incidents/classify", { text: b.data.description }); } catch (e) { safeLog(`classify failed: ${(e as Error).message}`); }
  const inc = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO incidents (title, description, severity, reported_by, predicted_category, category_confidence, related_alert_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.data.title, b.data.description, b.data.severity, req.user!.id, cls?.category ?? null, cls?.confidence ?? null, b.data.related_alert_id ?? null]);
    if (cls) await c.query(`INSERT INTO model_predictions (model_name, entity_type, entity_id, output) VALUES ($1,'incident',$2,$3)`,
      [cls.selected_model, String(ins.rows[0].id), cls]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "incident.create", entityType: "incident",
      entityId: ins.rows[0].id, ip: req.ip, details: { severity: b.data.severity, predicted_category: cls?.category } }, c);
    return ins.rows[0];
  });
  res.status(201).json({ incident: inc, classification: cls });
});

const Upd = z.object({ status: z.enum(STATUSES).optional(), assigned_to: z.number().int().nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(), final_category: z.enum(CATEGORIES).optional() });
r.patch("/:id", requireRole(...REVIEWERS), async (req, res) => {
  const b = Upd.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid update" });
  const out = await tx(async (c) => {
    const cur = await c.query("SELECT * FROM incidents WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!cur.rows[0]) return null;
    const d = b.data, old = cur.rows[0];
    const u = await c.query(
      `UPDATE incidents SET status=COALESCE($1,status), severity=COALESCE($2,severity), final_category=COALESCE($3,final_category),
              assigned_to=CASE WHEN $4::boolean THEN $5 ELSE assigned_to END, updated_at=now() WHERE id=$6 RETURNING *`,
      [d.status ?? null, d.severity ?? null, d.final_category ?? null, d.assigned_to !== undefined, d.assigned_to ?? null, req.params.id]);
    if (d.status && d.status !== old.status)
      await c.query("INSERT INTO incident_actions (incident_id, action_type, content, actor_id) VALUES ($1,'status_change',$2,$3)",
        [req.params.id, `Status changed from ${old.status} to ${d.status}`, req.user!.id]);
    if (d.assigned_to !== undefined && d.assigned_to !== old.assigned_to) {
      const who = d.assigned_to ? (await c.query("SELECT full_name FROM users WHERE id=$1", [d.assigned_to])).rows[0]?.full_name : "nobody";
      await c.query("INSERT INTO incident_actions (incident_id, action_type, content, actor_id) VALUES ($1,'assignment',$2,$3)",
        [req.params.id, `Assigned to ${who}`, req.user!.id]);
    }
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "incident.update", entityType: "incident",
      entityId: String(req.params.id), ip: req.ip, details: { ...d, previous_status: old.status } }, c);
    return u.rows[0];
  });
  if (!out) return res.status(404).json({ error: "not found" });
  res.json({ incident: out });
});

const NewAction = z.object({ action_type: z.enum(["note", "corrective_action"]), content: z.string().min(2).max(2000) });
r.post("/:id/actions", requireRole(...REVIEWERS), async (req, res) => {
  const b = NewAction.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid action" });
  const row = await tx(async (c) => {
    const ins = await c.query("INSERT INTO incident_actions (incident_id, action_type, content, actor_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [req.params.id, b.data.action_type, b.data.content, req.user!.id]);
    await c.query("UPDATE incidents SET updated_at=now() WHERE id=$1", [req.params.id]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: `incident.${b.data.action_type}.add`, entityType: "incident",
      entityId: String(req.params.id), ip: req.ip, details: { action_id: ins.rows[0].id } }, c);
    return ins.rows[0];
  });
  res.status(201).json({ action: row });
});

r.patch("/:id/actions/:aid", requireRole(...REVIEWERS), async (req, res) => {
  const completed = Boolean(req.body?.completed);
  const row = await tx(async (c) => {
    const u = await c.query("UPDATE incident_actions SET completed=$1 WHERE id=$2 AND incident_id=$3 AND action_type='corrective_action' RETURNING *",
      [completed, req.params.aid, req.params.id]);
    if (!u.rows[0]) return null;
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "incident.corrective_action.update", entityType: "incident",
      entityId: String(req.params.id), ip: req.ip, details: { action_id: req.params.aid, completed } }, c);
    return u.rows[0];
  });
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ action: row });
});

// ---------------------------------------------------------------- IR playbook + NPC breach clock
async function playbookState(id: string) {
  const [inc] = await query(
    "SELECT id, final_category, predicted_category, personal_data_breach, breach_discovered_at, npc_notified_at FROM incidents WHERE id=$1", [id]);
  if (!inc) return null;
  const category = inc.final_category ?? inc.predicted_category ?? null;
  const pb = playbookFor(category);
  const done = await query<{ step_key: string; completed_at: string; who: string | null }>(
    `SELECT p.step_key, p.completed_at, u.full_name AS who FROM incident_playbook_steps p LEFT JOIN users u ON u.id=p.completed_by
      WHERE p.incident_id=$1`, [id]);
  const steps = pb.steps.map((st) => { const d = done.find((x) => x.step_key === st.key);
    return { ...st, completed: Boolean(d), completed_at: d?.completed_at ?? null, completed_by: d?.who ?? null }; });
  const deadline = inc.breach_discovered_at ? new Date(new Date(inc.breach_discovered_at).getTime() + NPC_HOURS * 3600_000).toISOString() : null;
  return { category, title: pb.title, steps, progress: { done: steps.filter((x) => x.completed).length, total: steps.length },
    breach: { personal_data_breach: inc.personal_data_breach, discovered_at: inc.breach_discovered_at, notified_at: inc.npc_notified_at,
      deadline, hours: NPC_HOURS, rule: "NPC Circular 16-03, Sec. 17(A): notify the Commission within 72 hours of knowledge of the breach" } };
}

r.get("/:id/playbook", requireRole(...STAFF), async (req, res) => {
  const st = await playbookState(String(req.params.id));
  if (!st) return res.status(404).json({ error: "not found" });
  res.json(st);
});

r.put("/:id/playbook/:key", requireRole(...REVIEWERS), async (req, res) => {
  const id = String(req.params.id), key = String(req.params.key);
  const completed = Boolean(req.body?.completed);
  const st = await playbookState(id);
  if (!st) return res.status(404).json({ error: "not found" });
  const step = st.steps.find((x) => x.key === key);
  if (!step) return res.status(400).json({ error: "unknown step for this playbook" });
  await tx(async (c) => {
    if (completed) await c.query("INSERT INTO incident_playbook_steps (incident_id, step_key, completed_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, key, req.user!.id]);
    else await c.query("DELETE FROM incident_playbook_steps WHERE incident_id=$1 AND step_key=$2", [id, key]);
    await c.query("UPDATE incidents SET updated_at=now() WHERE id=$1", [id]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: completed ? "playbook.step_complete" : "playbook.step_uncomplete",
      entityType: "incident", entityId: id, ip: req.ip, details: { step: key, phase: step.phase, playbook: st.category ?? "general" } }, c);
  });
  res.json(await playbookState(id));
});

const Breach = z.object({ personal_data_breach: z.boolean().optional(), discovered_at: z.string().datetime({ offset: true }).optional(),
  npc_notified: z.boolean().optional() });
r.patch("/:id/breach", requireRole(...REVIEWERS), async (req, res) => {
  const b = Breach.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "invalid breach update" });
  const id = String(req.params.id);
  const ok = await tx(async (c) => {
    const cur = (await c.query("SELECT personal_data_breach, breach_discovered_at FROM incidents WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!cur) return false;
    const flag = b.data.personal_data_breach ?? cur.personal_data_breach;
    const discovered = flag ? (b.data.discovered_at ?? cur.breach_discovered_at ?? new Date().toISOString()) : null;
    await c.query(`UPDATE incidents SET personal_data_breach=$2, breach_discovered_at=$3,
                   npc_notified_at = CASE WHEN $4::boolean IS NULL THEN npc_notified_at WHEN $4 THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`,
      [id, flag, discovered, b.data.npc_notified ?? null]);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "incident.breach_update", entityType: "incident", entityId: id, ip: req.ip,
      details: { personal_data_breach: flag, npc_notified: b.data.npc_notified ?? null } }, c);
    return true;
  });
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json(await playbookState(id));
});

export default r;
