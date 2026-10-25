// Shapes returned by the backend API (and mirrored by the demo fixtures).
export type Role = "customer" | "dpo" | "security" | "admin" | "executive";
export interface SessionUser { id: number; role: Role; customerId: number | null; name: string; email?: string; mfa?: boolean }

export interface Consent { purpose: string; granted: boolean; updated_at: string }
export interface ConsentEvent { purpose: string; granted: boolean; channel: string; changed_at: string }
export interface DataRequest {
  id?: number; reference: string; type: "access" | "correction" | "deletion"; details: string;
  status: "submitted" | "in_review" | "completed" | "rejected"; response: string | null;
  created_at: string; updated_at: string; due_at: string; internal_note?: string | null; customer_id?: number; handled_by_name?: string | null;
}
export interface Citation { doc: string; title: string; section: string; score: number; passage: string }
export interface AssistantAnswer {
  answer: string; covered: boolean; confidence: number; citations: Citation[]; mode: string; retrieval_backend: string; demo_matched_question?: string;
}
export interface Kpis {
  kpis: { alerts_pending: number; alerts_confirmed: number; alerts_false_positive: number; incidents_open: number; incidents_total: number;
    requests_pending: number; requests_overdue: number; access_events_24h: number; marketing_consent_rate: number };
  incidents_by_category: { category: string; n: number }[];
}
export type AlertStatus = "flagged_for_review" | "confirmed" | "false_positive";
export interface AlertRow {
  id: number; risk_score: number; status: AlertStatus; created_at: string; reviewed_at: string | null; ts: string;
  employee_id: string; employee_role: string; resource: string; records_accessed: number; distinct_customers: number;
  export_flag: number; off_hours: number; hour_of_day: number; summary: string | null;
}
export interface ShapContribution { feature: string; label: string; value: number; shap: number }
export interface AlertDetail extends AlertRow {
  access_log_id: number; explanation: { contributions: ShapContribution[]; summary: string; base_value: number } | null;
  is_weekend: number; failed_logins: number; review_note: string | null; reviewer: string | null;
}
export interface IncidentRow {
  id: number; title: string; severity: "low" | "medium" | "high" | "critical"; status: string; predicted_category: string | null;
  category_confidence: number | null; final_category: string | null; reported_at: string; updated_at: string; assignee: string | null;
  personal_data_breach?: boolean; breach_discovered_at?: string | null; npc_notified_at?: string | null;
}
export interface IncidentAction { id: number; action_type: string; content: string; completed: boolean; created_at: string; actor: string | null }
export interface ModelVote { category: string; confidence: number; top3: { category: string; p: number }[] }
export interface IncidentDetail {
  incident: IncidentRow & { description: string; assigned_to: number | null; reporter: string | null; related_alert_id: number | null };
  actions: IncidentAction[];
  classification: { category: string; confidence: number; selected_model: string; agree: boolean; models: Record<string, ModelVote> } | null;
}
export interface StaffUser { id: number; full_name: string; role: Role }
export interface User { id: number; email: string; full_name: string; role: Role; customer_id: number | null; is_active: boolean; created_at: string; last_login_at: string | null;
  mfa_enabled?: boolean; locked?: boolean; locked_until?: string | null; failed_login_count?: number }
export interface AccessLog {
  id: number; ts: string; employee_id: string; employee_role: string; resource: string; hour_of_day: number; records_accessed: number;
  distinct_customers: number; off_hours: number; export_flag: number; failed_logins: number; risk_score: number | null;
}
export interface Forecast {
  metric: string; method: string;
  history: { date: string; count: number; rolling_7d: number }[];
  forecast: { date: string; predicted: number; lower: number; upper: number }[];
  trend: { slope_per_day: number; recent_7d_mean: number; baseline_mean: number; pct_change_vs_baseline: number; risk_level: string };
}
export interface AuditRow {
  id: number; created_at: string; actor_id: number | null; actor_role: string | null; actor_name: string | null; action: string;
  entity_type: string; entity_id: string | null; details: Record<string, unknown>; prev_hash: string; hash: string;
}
export interface ChainResult { valid: boolean; checked: number; brokenAtId: number | null; reason?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Metrics = any;

// ---------------------------------------------------------------- cybersecurity features
export type LoginResult = { user: SessionUser; csrfToken?: string } | { mfa_required: true; mfa_token: string };
export interface SessionRow { id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string; user_agent: string; device: string; mfa: boolean; current: boolean }
export interface LoginAttempt { id: number; ts: string; email?: string; ip: string; user_agent?: string; success: boolean; reason: string; country: string | null; city: string | null; threat_match: string | null; synthetic?: boolean }
export interface MfaStatus { enabled: boolean; backup_codes_remaining: number }
export interface MfaSetup { secret: string; otpauth_uri: string; qr: string }
export type Severity = "low" | "medium" | "high" | "critical";
export interface SecurityAlert {
  id: number; created_at: string; rule: string; technique_id: string | null; severity: Severity; title: string; description: string | null;
  email: string | null; ip: string | null; details: Record<string, unknown>; status: AlertStatus; reviewed_at: string | null; review_note: string | null;
  synthetic: boolean; reviewer: string | null;
}
export interface ThreatIndicator { id: number; indicator: string; category: string; confidence: number; source: string; description: string | null; first_seen: string; last_seen: string; hits: number }
export interface PostureComponent { key: string; label: string; weight: number; value: number; detail: string; tip: string }
export interface SocOverview {
  posture: { score: number; grade: string; components: PostureComponent[] };
  counts: Record<string, number>;
  by_severity: { severity: Severity; security: number; ml: number }[];
  daily: { day: string; failed: number; ok: number }[];
  top_users: { email: string; failed: number; ok: number; alerts: number }[];
  top_ips: { ip: string; failed: number; accounts: number; threat: string | null; country: string | null }[];
}
export interface FeedItem { kind: "login" | "security_alert" | "ml_alert"; id: string; at: string; severity: Severity; title: string; detail: string; technique_id: string | null }
export interface PhishingResult {
  kind: "url" | "email"; probability: number; label: "phishing" | "suspicious" | "likely_legitimate"; model: string;
  top_features: { feature: string; contribution: number; direction: "phishing" | "legitimate" }[];
  model_metrics: { precision?: number; recall?: number; f1?: number }; note: string;
}
export interface PlaybookStep { key: string; phase: "contain" | "eradicate" | "recover" | "lessons"; text: string; completed: boolean; completed_at: string | null; completed_by: string | null }
export interface Playbook {
  category: string | null; title: string; steps: PlaybookStep[]; progress: { done: number; total: number };
  breach: { personal_data_breach: boolean; discovered_at: string | null; notified_at: string | null; deadline: string | null; hours: number; rule: string };
}
export interface SelfCheckResult {
  target: string; scanned_at: string; score: number; grade: string;
  checks: { key: string; label: string; status: "pass" | "warn" | "fail" | "info"; value: string; tip: string }[];
}
