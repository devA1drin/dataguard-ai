/**
 * Single API surface for the UI. In live mode it calls the Express backend; with
 * NEXT_PUBLIC_DEMO_MODE=true it is served by the in-browser demo store (src/lib/demo.ts)
 * so the frontend can be deployed without backend, ML service or database.
 */
import { ALERT_TRANSPORT, API_URL, DEMO_MODE } from "./config";
import { demoApi } from "./demo";
import type {
  AccessLog, AlertDetail, AlertRow, AlertStatus, AssistantAnswer, AuditRow, ChainResult, Consent, ConsentEvent,
  DataRequest, FeedItem, Forecast, IncidentDetail, IncidentRow, Kpis, LoginAttempt, LoginResult, Metrics, MfaSetup, MfaStatus,
  PhishingResult, Playbook, Role, SecurityAlert, SelfCheckResult, SessionRow, SessionUser, SocOverview, StaffUser, ThreatIndicator, User,
} from "./types";

/** Cybersecurity endpoints - live mode only (undefined in demo mode; pages show a notice). */
export interface SecurityApi {
  sessions(): Promise<SessionRow[]>;
  revokeSession(id: string): Promise<void>;
  revokeOtherSessions(): Promise<number>;
  loginHistory(): Promise<LoginAttempt[]>;
  changePassword(current_password: string, new_password: string): Promise<{ other_sessions_revoked: number }>;
  mfaStatus(): Promise<MfaStatus>;
  mfaSetup(): Promise<MfaSetup>;
  mfaEnable(code: string): Promise<{ backup_codes: string[] }>;
  mfaDisable(password: string, code: string): Promise<void>;
  mfaBackupCodes(password: string, code: string): Promise<{ backup_codes: string[] }>;
  socOverview(): Promise<SocOverview>;
  socFeed(): Promise<{ items: FeedItem[]; server_time: string }>;
  securityAlerts(status?: AlertStatus): Promise<SecurityAlert[]>;
  reviewSecurityAlert(id: number, status: AlertStatus, note?: string): Promise<void>;
  loginAttempts(result?: "failed" | "success", q?: string): Promise<LoginAttempt[]>;
  threatIntel(): Promise<{ indicators: ThreatIndicator[]; note: string }>;
  simulateBruteForce(): Promise<{ attempts: number; alert: { id: number; title: string; technique_id: string; severity: string } | null }>;
  phishing(kind: "url" | "email", text: string): Promise<PhishingResult>;
  playbook(incidentId: number): Promise<Playbook>;
  setPlaybookStep(incidentId: number, key: string, completed: boolean): Promise<Playbook>;
  setBreach(incidentId: number, patch: { personal_data_breach?: boolean; discovered_at?: string; npc_notified?: boolean }): Promise<Playbook>;
  selfCheckTargets(): Promise<string[]>;
  selfCheck(target: number): Promise<SelfCheckResult>;
  unlockUser(id: number): Promise<void>;
  deleteUser(id: number): Promise<void>;
}

export interface Api {
  /** Current session (cookie-based in live mode), or null when signed out. */
  me(): Promise<SessionUser | null>;
  login(email: string, password: string): Promise<LoginResult>;
  verifyMfa?(mfaToken: string, code: string): Promise<LoginResult>;
  signup?(body: { full_name: string; email: string; password: string }): Promise<LoginResult>;
  logout(): Promise<void>;
  demoLogin?(role: Role): Promise<LoginResult>;
  sec?: SecurityApi;
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

/**
 * Live mode auth: the session lives in an httpOnly cookie the page can't read. The CSRF token
 * (returned by sign-in and /auth/me) is kept in memory only and sent on every state-changing request.
 */
let csrfToken: string | null = null;
const PUBLIC_PATHS = ["/login", "/signup"];

async function req<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(method !== "GET" && csrfToken ? { "x-csrf-token": csrfToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data && typeof data.csrfToken === "string") csrfToken = data.csrfToken;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth") && !PUBLIC_PATHS.includes(window.location.pathname)) {
      window.location.href = "/login";
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const sec: SecurityApi = {
  sessions: async () => (await req<{ sessions: SessionRow[] }>("/auth/sessions")).sessions,
  revokeSession: async (id) => { await req(`/auth/sessions/${id}`, "DELETE"); },
  revokeOtherSessions: async () => (await req<{ revoked: number }>("/auth/sessions/revoke-others", "POST")).revoked,
  loginHistory: async () => (await req<{ attempts: LoginAttempt[] }>("/auth/login-history")).attempts,
  changePassword: (current_password, new_password) => req("/auth/password", "POST", { current_password, new_password }),
  mfaStatus: () => req("/auth/mfa"),
  mfaSetup: () => req("/auth/mfa/setup", "POST"),
  mfaEnable: (code) => req("/auth/mfa/enable", "POST", { code }),
  mfaDisable: async (password, code) => { await req("/auth/mfa/disable", "POST", { password, code }); },
  mfaBackupCodes: (password, code) => req("/auth/mfa/backup-codes", "POST", { password, code }),
  socOverview: () => req("/soc/overview"),
  socFeed: () => req("/soc/feed"),
  securityAlerts: async (status) => (await req<{ alerts: SecurityAlert[] }>(`/soc/security-alerts${status ? `?status=${status}` : ""}`)).alerts,
  reviewSecurityAlert: async (id, status, note) => { await req(`/soc/security-alerts/${id}/review`, "PATCH", { status, note }); },
  loginAttempts: async (result, q) => (await req<{ attempts: LoginAttempt[] }>(
    `/soc/login-attempts?${new URLSearchParams({ ...(result ? { result } : {}), ...(q ? { q } : {}) })}`)).attempts,
  threatIntel: () => req("/soc/threat-intel"),
  simulateBruteForce: () => req("/soc/simulate/brute-force", "POST"),
  phishing: (kind, text) => req("/phishing/analyze", "POST", { kind, text }),
  playbook: (id) => req(`/incidents/${id}/playbook`),
  setPlaybookStep: (id, key, completed) => req(`/incidents/${id}/playbook/${encodeURIComponent(key)}`, "PUT", { completed }),
  setBreach: (id, patch) => req(`/incidents/${id}/breach`, "PATCH", patch),
  selfCheckTargets: async () => (await req<{ targets: string[] }>("/security/self-check/targets")).targets,
  selfCheck: (target) => req("/security/self-check", "POST", { target }),
  unlockUser: async (id) => { await req(`/users/${id}/unlock`, "POST"); },
  deleteUser: async (id) => { await req(`/users/${id}`, "DELETE"); },
};

const liveApi: Api = {
  me: async () => {
    try { return (await req<{ user: SessionUser }>("/auth/me")).user; }
    catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
  },
  login: (email, password) => req("/auth/login", "POST", { email, password }),
  verifyMfa: (mfa_token, code) => req("/auth/mfa/verify", "POST", { mfa_token, code }),
  signup: (body) => req("/auth/signup", "POST", body),
  logout: async () => { try { await req("/auth/logout", "POST"); } finally { csrfToken = null; } },
  sec,
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
    if (ALERT_TRANSPORT === "poll") {
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
    if (typeof EventSource === "undefined") return () => {};
    // The session cookie is sent automatically (withCredentials for the cross-origin Docker setup).
    const es = new EventSource(`${API_URL}/api/alerts/stream`, { withCredentials: true });
    es.addEventListener("alert", (e) => cb(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  },
};

export const api: Api = DEMO_MODE ? demoApi : liveApi;
