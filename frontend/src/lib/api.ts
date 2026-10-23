/**
 * Single API surface for the UI. In live mode it calls the Express backend; with
 * NEXT_PUBLIC_DEMO_MODE=true it is served by the in-browser demo store (src/lib/demo.ts)
 * so the frontend can be deployed without backend, ML service or database.
 */
import { ALERT_TRANSPORT, API_URL, DEMO_MODE } from "./config";
import { demoApi } from "./demo";
import type {
  AccessLog, AlertDetail, AlertRow, AlertStatus, AssistantAnswer, AuditRow, ChainResult, Consent, ConsentEvent,
  DataRequest, Forecast, IncidentDetail, IncidentRow, Kpis, Metrics, Role, SessionUser, StaffUser, User,
} from "./types";

export interface Api {
  login(email: string, password: string): Promise<{ token: string; user: SessionUser }>;
  demoLogin?(role: Role): Promise<{ token: string; user: SessionUser }>;
  consents(): Promise<Consent[]>;
  consentHistory(): Promise<ConsentEvent[]>;
  setConsent(purpose: string, granted: boolean): Promise<Consent>;
  myRequests(): Promise<DataRequest[]>;
  createRequest(type: DataRequest["type"], details: string): Promise<DataRequest>;
  allRequests(): Promise<DataRequest[]>;
  updateRequest(id: number, patch: Partial<Pick<DataRequest, "status" | "response" | "internal_note">>): Promise<void>;
  ask(question: string): Promise<AssistantAnswer>;
  kpis(): Promise<Kpis>;
  alerts(status?: AlertStatus): Promise<AlertRow[]>;
  alert(id: number): Promise<AlertDetail>;
  reviewAlert(id: number, status: AlertStatus, note?: string): Promise<void>;
  incidents(): Promise<IncidentRow[]>;
  incident(id: number): Promise<IncidentDetail>;
  createIncident(body: { title: string; description: string; severity: string; related_alert_id?: number }): Promise<{ incident: { id: number } }>;
  updateIncident(id: number, patch: { status?: string; assigned_to?: number | null; severity?: string; final_category?: string }): Promise<void>;
  addAction(id: number, action_type: "note" | "corrective_action", content: string): Promise<void>;
  toggleAction(id: number, actionId: number, completed: boolean): Promise<void>;
  staff(): Promise<StaffUser[]>;
  users(): Promise<User[]>;
  createUser(body: { email: string; full_name: string; role: Role; password: string }): Promise<void>;
  updateUser(id: number, patch: { role?: Role; is_active?: boolean }): Promise<void>;
  accessLogs(): Promise<AccessLog[]>;
  forecast(metric: "anomalies" | "incidents"): Promise<Forecast>;
  metrics(): Promise<Metrics>;
  auditLogs(): Promise<AuditRow[]>;
  verifyAudit(): Promise<ChainResult>;
  /** Live mode only: generate synthetic access events and score them now. */
  simulate?(count: number, suspicious: boolean): Promise<SimulateResult>;
  /** Subscribe to new alerts (SSE or polling in live mode). Returns an unsubscribe function. */
  onAlert(cb: (a: { id: number; risk_score: number }) => void): () => void;
}

export interface SimulateResult {
  inserted: number; scored: number;
  new_alerts: { id: number; risk_score: number; access_log_id: number; summary: string | null }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const TOKEN_KEY = "dataguard-token";
export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
      tokenStore.clear();
      window.location.href = "/login";
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const liveApi: Api = {
  login: (email, password) => req("/auth/login", "POST", { email, password }),
  consents: async () => (await req<{ consents: Consent[] }>("/consents/me")).consents,
  consentHistory: async () => (await req<{ history: ConsentEvent[] }>("/consents/me/history")).history,
  setConsent: async (p, granted) => (await req<{ consent: Consent }>(`/consents/me/${p}`, "PUT", { granted })).consent,
  myRequests: async () => (await req<{ requests: DataRequest[] }>("/requests/me")).requests,
  createRequest: async (type, details) => (await req<{ request: DataRequest }>("/requests", "POST", { type, details })).request,
  allRequests: async () => (await req<{ requests: DataRequest[] }>("/requests")).requests,
  updateRequest: async (id, patch) => { await req(`/requests/${id}`, "PATCH", patch); },
  ask: (question) => req("/assistant/ask", "POST", { question }),
  kpis: () => req("/dashboard/kpis"),
  alerts: async (status) => (await req<{ alerts: AlertRow[] }>(`/alerts${status ? `?status=${status}` : ""}`)).alerts,
  alert: async (id) => (await req<{ alert: AlertDetail }>(`/alerts/${id}`)).alert,
  reviewAlert: async (id, status, note) => { await req(`/alerts/${id}/review`, "PATCH", { status, note }); },
  incidents: async () => (await req<{ incidents: IncidentRow[] }>("/incidents")).incidents,
  incident: (id) => req(`/incidents/${id}`),
  createIncident: (body) => req("/incidents", "POST", body),
  updateIncident: async (id, patch) => { await req(`/incidents/${id}`, "PATCH", patch); },
  addAction: async (id, action_type, content) => { await req(`/incidents/${id}/actions`, "POST", { action_type, content }); },
  toggleAction: async (id, aid, completed) => { await req(`/incidents/${id}/actions/${aid}`, "PATCH", { completed }); },
  staff: async () => (await req<{ users: StaffUser[] }>("/users/staff")).users,
  users: async () => (await req<{ users: User[] }>("/users")).users,
  createUser: async (body) => { await req("/users", "POST", body); },
  updateUser: async (id, patch) => { await req(`/users/${id}`, "PATCH", patch); },
  accessLogs: async () => (await req<{ logs: AccessLog[] }>("/access-logs?limit=150")).logs,
  forecast: (metric) => req(`/risk/forecast?metric=${metric}`),
  metrics: () => req("/metrics"),
  auditLogs: async () => (await req<{ logs: AuditRow[] }>("/audit-logs?limit=500")).logs,
  verifyAudit: () => req("/audit-logs/verify"),
  simulate: (count, suspicious) => req("/access-logs/simulate", "POST", { count, suspicious }),
  onAlert: (cb) => {
    const token = tokenStore.get();
    if (token && ALERT_TRANSPORT === "poll") {
      // Serverless backend: poll a tiny endpoint instead of holding an SSE connection open.
      let last: number | null = null;
      let stopped = false;
      const tick = async () => {
        try {
          const r = await req<{ max_id: number }>("/alerts/latest");
          if (last !== null && r.max_id > last) for (let id = last + 1; id <= r.max_id; id++) cb({ id, risk_score: NaN });
          last = Math.max(last ?? 0, r.max_id);
        } catch { /* transient; try again next tick */ }
      };
      void tick();
      const t = setInterval(() => { if (!stopped && document.visibilityState === "visible") void tick(); }, 15000);
      return () => { stopped = true; clearInterval(t); };
    }
    if (!token || typeof EventSource === "undefined") return () => {};
    const es = new EventSource(`${API_URL}/api/alerts/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener("alert", (e) => cb(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  },
};

export const api: Api = DEMO_MODE ? demoApi : liveApi;
