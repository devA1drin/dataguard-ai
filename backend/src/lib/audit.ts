import crypto from "crypto";
import { PoolClient } from "pg";
import { pool } from "../db";
import { maskValue } from "./mask";

/**
 * Append-only, hash-chained audit log.
 *
 *   hash_n = sha256( hash_{n-1} + canonicalJSON({created_at, actor_id, actor_role, action, entity_type, entity_id, details}) )
 *
 * The first row uses GENESIS as prev_hash. Changing, deleting or re-ordering any row breaks
 * every following hash, which `verifyChain()` detects. The DB trigger additionally blocks
 * UPDATE/DELETE for normal connections.
 */
export const GENESIS = "0".repeat(64);
const LOCK_KEY = 732001; // advisory lock id so concurrent writers can't fork the chain

export interface AuditEntry {
  actorId: number | null;
  actorRole: string | null;
  action: string;          // e.g. "consent.withdraw"
  entityType: string;      // e.g. "consent"
  entityId?: string | number | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Deterministic JSON: object keys sorted recursively (jsonb does not preserve key order). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function computeHash(prevHash: string, row: {
  created_at: string; actor_id: number | null; actor_role: string | null; action: string;
  entity_type: string; entity_id: string | null; details: unknown;
}): string {
  return crypto.createHash("sha256").update(prevHash + canonical(row)).digest("hex");
}

/** Write one audit row. Pass a client to make it part of an existing transaction. */
export async function audit(e: AuditEntry, client?: PoolClient): Promise<void> {
  const own = !client;
  const c = client ?? (await pool.connect());
  try {
    if (own) await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const prev = await c.query("SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1");
    const prevHash: string = prev.rows[0]?.hash ?? GENESIS;
    const row = {
      created_at: new Date().toISOString(),
      actor_id: e.actorId,
      actor_role: e.actorRole,
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId == null ? null : String(e.entityId),
      details: maskValue(e.details ?? {}) as Record<string, unknown>, // never store raw PII in the audit trail
    };
    const hash = computeHash(prevHash, row);
    await c.query(
      `INSERT INTO audit_logs (created_at, actor_id, actor_role, action, entity_type, entity_id, details, ip, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.created_at, row.actor_id, row.actor_role, row.action, row.entity_type, row.entity_id, row.details, e.ip ?? null, prevHash, hash],
    );
    if (own) await c.query("COMMIT");
  } catch (err) {
    if (own) await c.query("ROLLBACK");
    throw err;
  } finally {
    if (own) c.release();
  }
}

/** Re-compute the whole chain. Returns the first broken row id, if any. */
export async function verifyChain(): Promise<{ valid: boolean; checked: number; brokenAtId: number | null; reason?: string }> {
  const { rows } = await pool.query("SELECT * FROM audit_logs ORDER BY id ASC");
  let prev = GENESIS;
  for (const r of rows) {
    const expected = computeHash(prev, {
      created_at: new Date(r.created_at).toISOString(),
      actor_id: r.actor_id, actor_role: r.actor_role, action: r.action,
      entity_type: r.entity_type, entity_id: r.entity_id, details: r.details,
    });
    if (r.prev_hash !== prev) return { valid: false, checked: rows.length, brokenAtId: Number(r.id), reason: "prev_hash mismatch" };
    if (r.hash !== expected) return { valid: false, checked: rows.length, brokenAtId: Number(r.id), reason: "content hash mismatch" };
    prev = r.hash;
  }
  return { valid: true, checked: rows.length, brokenAtId: null };
}
