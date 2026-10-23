import { config } from "../config";
import { pool, query } from "../db";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { safeLog } from "../lib/mask";
import { AccessLogRow, ml, toMlEvent } from "../lib/ml";

/**
 * Background job: scores new (unscored) access logs with the ML service.
 * Events at/above ALERT_THRESHOLD become alerts with status "flagged_for_review".
 * An alert is a prompt for a human to look, never an automatic accusation.
 * Also asks the ML service to suggest a category for unclassified incidents.
 */
let running = false;

export async function scoreBatch(limit = 500): Promise<number> {
  const rows = await query<AccessLogRow>(
    `SELECT id, hour_of_day, records_accessed, distinct_customers, export_flag, employee_role,
            off_hours, is_weekend, failed_logins
       FROM access_logs WHERE scored_at IS NULL ORDER BY id LIMIT $1`, [limit]);
  if (!rows.length) return 0;
  const events = rows.map(toMlEvent);
  const scored = await ml<{ results: { id: string; anomaly_score: number; risk_score: number; flagged_for_review: boolean }[] }>(
    "/anomaly/score", { events, threshold: config.alertThreshold });
  const flagged = scored.results.filter((r) => r.flagged_for_review);
  const explanations = new Map<string, unknown>();
  if (flagged.length) {
    const ex = await ml<{ results: { id: string; contributions: unknown; summary: string; base_value: number }[] }>(
      "/anomaly/explain", { events: events.filter((e) => flagged.some((f) => f.id === e.id)) });
    ex.results.forEach((r) => explanations.set(r.id, { contributions: r.contributions, summary: r.summary, base_value: r.base_value }));
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of scored.results) {
      await client.query("UPDATE access_logs SET risk_score=$1, anomaly_score=$2, scored_at=now() WHERE id=$3",
        [r.risk_score, r.anomaly_score, r.id]);
    }
    for (const f of flagged) {
      const ins = await client.query(
        `INSERT INTO alerts (access_log_id, risk_score, explanation) VALUES ($1,$2,$3)
         ON CONFLICT (access_log_id) DO NOTHING RETURNING id`, [f.id, f.risk_score, explanations.get(f.id) ?? null]);
      await client.query(
        `INSERT INTO model_predictions (model_name, entity_type, entity_id, output) VALUES ('isolation_forest','access_log',$1,$2)`,
        [f.id, { risk_score: f.risk_score, anomaly_score: f.anomaly_score, explanation: explanations.get(f.id) }]);
      if (ins.rows[0]) {
        await audit({ actorId: null, actorRole: "system", action: "alert.create", entityType: "alert",
          entityId: ins.rows[0].id, details: { access_log_id: f.id, risk_score: f.risk_score } }, client);
        bus.emit("alert", { id: ins.rows[0].id, access_log_id: f.id, risk_score: f.risk_score });
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  safeLog(`scored ${rows.length} access events, ${flagged.length} flagged for review`);
  return rows.length;
}

export async function classifyPendingIncidents() {
  const rows = await query<{ id: number; description: string }>(
    "SELECT id, description FROM incidents WHERE predicted_category IS NULL ORDER BY id LIMIT 50");
  for (const r of rows) {
    const out = await ml<{ category: string; confidence: number; selected_model: string; models: unknown }>(
      "/incidents/classify", { text: r.description });
    await query("UPDATE incidents SET predicted_category=$1, category_confidence=$2 WHERE id=$3", [out.category, out.confidence, r.id]);
    await query(`INSERT INTO model_predictions (model_name, entity_type, entity_id, output) VALUES ($1,'incident',$2,$3)`,
      [out.selected_model, String(r.id), out]);
  }
}

export function startScorer() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while ((await scoreBatch()) === 500) { /* drain backlog */ }
      await classifyPendingIncidents();
    } catch (e) {
      safeLog(`scorer: ML service not reachable yet or failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, config.scoreIntervalMs);
}

/** Synthetic access event generator (~6% suspicious bulk-access patterns unless forced). */
const SIM_ROLES = ["support_agent", "marketing", "analyst", "it_admin", "finance"];
const SIM_RESOURCES = ["customer_profile", "order_history", "payment_info", "contact_details", "loyalty_points"];

export async function insertSyntheticEvents(n = 1, forceSuspicious = false): Promise<number> {
  let suspiciousCount = 0;
  for (let i = 0; i < n; i++) {
    const now = new Date();
    const hourPH = (now.getUTCHours() + 8) % 24;
    const suspicious = forceSuspicious ? i === 0 : Math.random() < 0.06;
    if (suspicious) suspiciousCount++;
    const role = SIM_ROLES[Math.floor(Math.random() * SIM_ROLES.length)];
    const records = suspicious ? 300 + Math.floor(Math.random() * 1500) : 1 + Math.floor(Math.random() * 30);
    const distinct = Math.max(1, Math.floor(records * (0.5 + Math.random() * 0.5)));
    const weekend = [0, 6].includes(now.getUTCDay()) ? 1 : 0;
    await query(
      `INSERT INTO access_logs (ts, employee_id, employee_role, resource, customer_id, hour_of_day, records_accessed,
         distinct_customers, off_hours, is_weekend, export_flag, failed_logins, synthetic_label, synthetic_type)
       VALUES (now(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [`E${String(1 + Math.floor(Math.random() * 60)).padStart(3, "0")}`, role,
        SIM_RESOURCES[Math.floor(Math.random() * SIM_RESOURCES.length)], 1 + Math.floor(Math.random() * 400), hourPH, records, distinct,
        hourPH < 7 || hourPH >= 20 || weekend ? 1 : 0, weekend, suspicious ? 1 : Number(Math.random() < 0.03), suspicious ? 2 : 0,
        suspicious, suspicious ? "simulated_bulk_access" : null]);
  }
  return suspiciousCount;
}

/** Drain the unscored backlog within a time budget (serverless-friendly: used by the cron endpoint). */
export async function scorePending(budgetMs = 240_000): Promise<{ scored: number; done: boolean }> {
  const t0 = Date.now();
  let scored = 0;
  for (;;) {
    const n = await scoreBatch();
    scored += n;
    if (n < 500) return { scored, done: true };
    if (Date.now() - t0 > budgetMs) return { scored, done: false };
  }
}

/** Demo simulator for the long-running server: inserts a synthetic access event periodically. */
export function startSimulator() {
  setInterval(async () => {
    try {
      await insertSyntheticEvents(1);
    } catch (e) {
      safeLog(`simulator insert failed: ${(e as Error).message}`);
    }
  }, config.simulateIntervalMs);
}
