/**
 * DEMO MODE data layer (NEXT_PUBLIC_DEMO_MODE=true).
 *
 * Serves the UI from src/demo/fixtures.json - real outputs exported from the full stack
 * (Isolation Forest scores + SHAP explanations, incident classifications, risk trend,
 * evaluation metrics, retrieval answers with citations) generated on SYNTHETIC data by
 * scripts/export-demo-fixtures.mjs.
 *
 * Mutations only change browser state (localStorage). New audit rows are appended with
 * the same SHA-256 hash chain as the backend, so "Verify chain" works in demo mode too.
 */
import fixturesJson from "../demo/fixtures.json";
import type { Api } from "./api";
import { GENESIS, canonical, sha256 } from "./hash";
import type {
  AccessLog, AlertDetail, AlertRow, AssistantAnswer, AuditRow, Consent, ConsentEvent, DataRequest, Forecast,
  IncidentDetail, IncidentRow, Kpis, Metrics, Role, SessionUser, StaffUser, User,
} from "./types";

interface DemoState {
  sessions: Record<Role, SessionUser>;
  consents: Consent[]; consentHistory: ConsentEvent[]; myRequests: DataRequest[]; allRequests: DataRequest[];
  kpis: Kpis; alerts: AlertRow[]; alertDetails: Record<string, AlertDetail>; incidents: IncidentRow[];
  incidentDetails: Record<string, IncidentDetail>; staff: StaffUser[]; users: User[]; accessLogs: AccessLog[];
  forecast: Record<"anomalies" | "incidents", Forecast>; metrics: Metrics;
  assistant: (AssistantAnswer & { question: string })[]; auditLogs: AuditRow[]; generated_at: string;
}

const KEY = "dataguard-demo-state-v1";
const SESSION_KEY = "dataguard-demo-session";
const fixtures = fixturesJson as unknown as DemoState;
let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  const saved = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
  state = saved ? (JSON.parse(saved) as DemoState) : structuredClone(fixtures);
  // Postgres BIGSERIAL ids arrive as strings in older exports; normalise so the chain order is numeric.
  state.auditLogs.forEach((r) => { r.id = Number(r.id); });
  return state;
}
function save() {
  if (typeof window !== "undefined" && state) localStorage.setItem(KEY, JSON.stringify(state));
}
export function resetDemo() {
  state = structuredClone(fixtures);
  save();
}
export const demoGeneratedAt = fixtures.generated_at;

const clone = <T>(v: T): T => structuredClone(v);
const delay = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(clone(v)), ms));
const now = () => new Date().toISOString();

function currentUser(): SessionUser {
  const raw = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
  return raw ? (JSON.parse(raw) as SessionUser) : load().sessions.dpo;
}

/** Append a hash-chained audit row (same algorithm as backend/src/lib/audit.ts). */
async function audit(action: string, entityType: string, entityId: string | number | null, details: Record<string, unknown> = {}) {
  const s = load();
  const u = currentUser();
  const prev = s.auditLogs.length ? s.auditLogs.reduce((a, b) => (a.id > b.id ? a : b)) : null;
  const row = { created_at: now(), actor_id: u.id, actor_role: u.role, action, entity_type: entityType,
    entity_id: entityId == null ? null : String(entityId), details };
  const prevHash = prev?.hash ?? GENESIS;
  const hash = await sha256(prevHash + canonical(row));
  s.auditLogs.unshift({ id: (prev?.id ?? 0) + 1, ...row, actor_name: u.name, prev_hash: prevHash, hash });
}

function recomputeKpis(s: DemoState) {
  s.kpis.kpis.alerts_pending = s.alerts.filter((a) => a.status === "flagged_for_review").length;
  s.kpis.kpis.alerts_confirmed = s.alerts.filter((a) => a.status === "confirmed").length;
  s.kpis.kpis.alerts_false_positive = s.alerts.filter((a) => a.status === "false_positive").length;
  s.kpis.kpis.incidents_open = s.incidents.filter((i) => !["resolved", "closed"].includes(i.status)).length;
  s.kpis.kpis.incidents_total = s.incidents.length;
  s.kpis.kpis.requests_pending = s.allRequests.filter((r) => ["submitted", "in_review"].includes(r.status)).length;
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));

export const demoApi: Api = {
  // Demo mode has no accounts and no passwords: visitors pick a role (stored in this browser only).
  async me() {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  },
  async login() {
    throw new Error("Demo mode: choose a role below - no password is needed.");
  },
  async logout() {
    localStorage.removeItem(SESSION_KEY);
  },
  async demoLogin(role) {
    const user = load().sessions[role];
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    await audit("auth.login", "user", user.id, { demo: true });
    save();
    return { user };
  },
  consents: async () => delay(load().consents),
  consentHistory: async () => delay(load().consentHistory),
  async setConsent(purpose, granted) {
    const s = load();
    const c = s.consents.find((x) => x.purpose === purpose)!;
    c.granted = granted; c.updated_at = now();
    s.consentHistory.unshift({ purpose, granted, channel: "portal", changed_at: c.updated_at });
    await audit(granted ? "consent.grant" : "consent.withdraw", "consent", `${currentUser().customerId}:${purpose}`, { purpose, granted });
    save();
    return delay(c);
  },
  myRequests: async () => delay(load().myRequests),
  async createRequest(type, details) {
    const s = load();
    const ref = `DR-${new Date().getFullYear()}-${String(s.allRequests.length + 1).padStart(4, "0")}-DEMO`;
    const due = new Date(Date.now() + 21 * 864e5).toISOString();
    const r: DataRequest = { reference: ref, type, details, status: "submitted", response: null, created_at: now(), updated_at: now(), due_at: due };
    s.myRequests.unshift(r);
    s.allRequests.unshift({ ...r, id: Math.max(...s.allRequests.map((x) => x.id ?? 0)) + 1, customer_id: 1, internal_note: null, handled_by_name: null });
    await audit("data_request.create", "data_request", ref, { reference: ref, type });
    recomputeKpis(s); save();
    return delay(r);
  },
  allRequests: async () => delay(load().allRequests),
  async updateRequest(id, patch) {
    const s = load();
    const r = s.allRequests.find((x) => x.id === id)!;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updated_at: now(), handled_by_name: currentUser().name });
    const mine = s.myRequests.find((x) => x.reference === r.reference);
    if (mine) Object.assign(mine, { status: r.status, response: r.response, updated_at: r.updated_at });
    await audit("data_request.update", "data_request", id, { status: patch.status, responded: !!patch.response });
    recomputeKpis(s); save();
  },
  async ask(question) {
    // Demo mode cannot run the embedding model in the browser. Answers were produced by the
    // real retrieval pipeline for a fixed set of questions; we match to the closest one.
    const q = words(question);
    let best: (AssistantAnswer & { question: string }) | null = null, bestScore = 0;
    for (const a of load().assistant) {
      const w = words(a.question);
      const inter = [...q].filter((x) => w.has(x)).length;
      const score = inter / Math.max(1, Math.min(q.size, w.size));
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (!best || bestScore < 0.5) {
      return delay({ answer: "This question does not appear to be covered by the Acme Retail PH privacy policy documents. Please contact the Data Protection Officer for help. (Demo mode only has pre-computed answers for the suggested questions.)",
        covered: false, confidence: 0, citations: [], mode: "refusal", retrieval_backend: "demo-fixtures" }, 500);
    }
    const { question: matched, ...ans } = best;
    return delay({ ...ans, demo_matched_question: matched }, 600);
  },
  kpis: async () => delay(load().kpis),
  alerts: async (status) => delay(load().alerts.filter((a) => !status || a.status === status)),
  async alert(id) {
    const a = load().alertDetails[String(id)];
    if (!a) throw new Error("Alert not found");
    return delay(a);
  },
  async reviewAlert(id, status, note) {
    const s = load();
    const row = s.alerts.find((a) => a.id === id)!;
    row.status = status; row.reviewed_at = now();
    Object.assign(s.alertDetails[String(id)], { status, reviewed_at: row.reviewed_at, review_note: note ?? null, reviewer: currentUser().name });
    await audit("alert.review", "alert", id, { status });
    recomputeKpis(s); save();
  },
  incidents: async () => delay(load().incidents),
  async incident(id) {
    const d = load().incidentDetails[String(id)];
    if (!d) throw new Error("Incident not found");
    return delay(d);
  },
  async createIncident(body) {
    const s = load();
    const id = Math.max(...s.incidents.map((i) => i.id)) + 1;
    const row: IncidentRow = { id, title: body.title, severity: body.severity as IncidentRow["severity"], status: "open",
      predicted_category: null, category_confidence: null, final_category: null, reported_at: now(), updated_at: now(), assignee: null };
    s.incidents.unshift(row);
    s.incidentDetails[String(id)] = { incident: { ...row, description: body.description, assigned_to: null, reporter: currentUser().name,
      related_alert_id: body.related_alert_id ?? null }, actions: [], classification: null };
    await audit("incident.create", "incident", id, { severity: body.severity, demo_note: "ML classification unavailable in demo mode" });
    recomputeKpis(s); save();
    return { incident: { id } };
  },
  async updateIncident(id, patch) {
    const s = load();
    const d = s.incidentDetails[String(id)];
    const row = s.incidents.find((i) => i.id === id)!;
    const actor = currentUser().name;
    if (patch.status && patch.status !== d.incident.status)
      d.actions.push({ id: Date.now(), action_type: "status_change", content: `Status changed from ${d.incident.status} to ${patch.status}`, completed: false, created_at: now(), actor });
    if (patch.assigned_to !== undefined && patch.assigned_to !== d.incident.assigned_to) {
      const who = s.staff.find((u) => u.id === patch.assigned_to)?.full_name ?? "nobody";
      d.actions.push({ id: Date.now() + 1, action_type: "assignment", content: `Assigned to ${who}`, completed: false, created_at: now(), actor });
      d.incident.assigned_to = patch.assigned_to; d.incident.assignee = row.assignee = patch.assigned_to ? who : null;
    }
    for (const k of ["status", "severity", "final_category"] as const) if (patch[k]) {
      (d.incident as unknown as Record<string, unknown>)[k] = patch[k]; (row as unknown as Record<string, unknown>)[k] = patch[k];
    }
    d.incident.updated_at = row.updated_at = now();
    await audit("incident.update", "incident", id, { ...patch });
    recomputeKpis(s); save();
  },
  async addAction(id, action_type, content) {
    const d = load().incidentDetails[String(id)];
    d.actions.push({ id: Date.now(), action_type, content, completed: false, created_at: now(), actor: currentUser().name });
    await audit(`incident.${action_type}.add`, "incident", id, {});
    save();
  },
  async toggleAction(id, aid, completed) {
    const a = load().incidentDetails[String(id)].actions.find((x) => x.id === aid)!;
    a.completed = completed;
    await audit("incident.corrective_action.update", "incident", id, { action_id: aid, completed });
    save();
  },
  staff: async () => delay(load().staff),
  users: async () => delay(load().users),
  async createUser(body) {
    const s = load();
    const id = Math.max(...s.users.map((u) => u.id)) + 1;
    s.users.push({ id, email: body.email, full_name: body.full_name, role: body.role, customer_id: null, is_active: true, created_at: now(), last_login_at: null });
    await audit("user.create", "user", id, { role: body.role });
    save();
  },
  async updateUser(id, patch) {
    const u = load().users.find((x) => x.id === id)!;
    Object.assign(u, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    await audit("user.update", "user", id, patch);
    save();
  },
  accessLogs: async () => delay(load().accessLogs),
  forecast: async (metric) => delay(load().forecast[metric]),
  metrics: async () => delay(load().metrics),
  auditLogs: async () => delay(load().auditLogs),
  async verifyAudit() {
    const rows = [...load().auditLogs].sort((a, b) => a.id - b.id);
    let prev = GENESIS;
    for (const r of rows) {
      const expected = await sha256(prev + canonical({ created_at: r.created_at, actor_id: r.actor_id, actor_role: r.actor_role, action: r.action,
        entity_type: r.entity_type, entity_id: r.entity_id, details: r.details }));
      if (r.prev_hash !== prev) return { valid: false, checked: rows.length, brokenAtId: r.id, reason: "prev_hash mismatch" };
      if (r.hash !== expected) return { valid: false, checked: rows.length, brokenAtId: r.id, reason: "content hash mismatch" };
      prev = r.hash;
    }
    return { valid: true, checked: rows.length, brokenAtId: null };
  },
  onAlert: () => () => {},
};
