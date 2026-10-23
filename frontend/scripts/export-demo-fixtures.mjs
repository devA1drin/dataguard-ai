/**
 * Export demo-mode fixtures from a RUNNING full stack (postgres + ml-service + backend).
 *
 *   node scripts/export-demo-fixtures.mjs [--api http://localhost:4000] [--with-activity]
 *
 * --with-activity first performs a realistic set of actions through the real API
 * (consent changes, alert reviews, incident notes...) so the exported audit log and
 * statuses look like a lived-in system. Everything is synthetic.
 *
 * Output: src/demo/fixtures.json - consumed by src/lib/demo.ts when NEXT_PUBLIC_DEMO_MODE=true.
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const API = args.includes("--api") ? args[args.indexOf("--api") + 1] : "http://localhost:4000";
const PASSWORD = "DemoPass123!";

async function call(token, path, method = "GET", body) {
  const res = await fetch(`${API}/api${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
const login = async (email) => call(null, "/auth/login", "POST", { email, password: PASSWORD });

const sessions = {};
for (const [role, email] of Object.entries({
  customer: "customer@dataguard.demo", dpo: "dpo@dataguard.demo", security: "security@dataguard.demo",
  admin: "admin@dataguard.demo", executive: "exec@dataguard.demo" })) sessions[role] = await login(email);
const T = Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, v.token]));

if (args.includes("--with-activity")) {
  console.log("performing demo activity through the API ...");
  await call(T.customer, "/consents/me/sms_promotions", "PUT", { granted: false });
  await call(T.customer, "/consents/me/analytics", "PUT", { granted: true });
  await call(T.customer, "/consents/me/third_party_sharing", "PUT", { granted: false });
  await call(T.customer, "/requests", "POST", { type: "correction", details: "Please update my mobile number on file; the old one is no longer active." });
  const { requests } = await call(T.dpo, "/requests");
  const r2 = requests.find((r) => r.reference === "DR-2026-0002");
  if (r2) await call(T.dpo, `/requests/${r2.id}`, "PATCH", { status: "in_review", response: "We are verifying your new address. We will update your record within 3 working days.", internal_note: "ID verified via registered email" });
  const { alerts } = await call(T.dpo, "/alerts");
  const sorted = [...alerts].sort((a, b) => b.risk_score - a.risk_score);
  for (const a of sorted.slice(0, 6)) await call(T.security, `/alerts/${a.id}/review`, "PATCH", { status: "confirmed", note: "Bulk access without an approved ticket. Escalated to incident process." });
  for (const a of sorted.slice(-5)) await call(T.dpo, `/alerts/${a.id}/review`, "PATCH", { status: "false_positive", note: "Matches an approved reporting job (ticket on file)." });
  const staff = (await call(T.dpo, "/users/staff")).users;
  const sec = staff.find((u) => u.role === "security");
  const top = sorted[0];
  await call(T.security, "/incidents", "POST", { title: `Off-hours bulk export by ${top.employee_id}`, severity: "high", related_alert_id: top.id,
    description: `An employee account (${top.employee_id}) accessed ${top.records_accessed} customer profiles outside their assigned queue and exported the data without an approved ticket. Flagged by anomaly alert #${top.id} and confirmed by security review. The incident was escalated to the DPO for review.` });
  const { incidents } = await call(T.dpo, "/incidents");
  for (const inc of incidents.slice(0, 6)) {
    await call(T.dpo, `/incidents/${inc.id}`, "PATCH", { assigned_to: sec.id, status: "investigating" });
    await call(T.dpo, `/incidents/${inc.id}/actions`, "POST", { action_type: "note", content: "Triage complete. Collected access logs for the affected period." });
    await call(T.security, `/incidents/${inc.id}/actions`, "POST", { action_type: "corrective_action", content: "Revoke export permission pending manager approval and enable MFA on the CRM account." });
  }
  await call(T.admin, "/users", "POST", { email: "mika.security@dataguard.demo", full_name: "Mika Torres (Security)", role: "security", password: `Tmp-${crypto.randomUUID()}` });
  await call(T.dpo, "/audit-logs/verify");
}

console.log("exporting fixtures ...");
const alertsList = (await call(T.dpo, "/alerts")).alerts;
const alertDetails = {};
for (const a of alertsList) alertDetails[a.id] = (await call(T.dpo, `/alerts/${a.id}`)).alert;
const incidentsList = (await call(T.dpo, "/incidents")).incidents;
const incidentDetails = {};
for (const i of incidentsList) incidentDetails[i.id] = await call(T.dpo, `/incidents/${i.id}`);

const QUESTIONS = [
  "How do I withdraw my consent for SMS promotions?",
  "How long do you keep my order records?",
  "Can I ask you to delete my account data?",
  "Do you sell my personal data to other companies?",
  "How do I correct my delivery address?",
  "Who is the Data Protection Officer and how do I contact them?",
  "What happens if there is a data breach?",
  "What is the best pizza place in Makati?",
];
const assistant = [];
for (const q of QUESTIONS) assistant.push({ question: q, ...(await call(T.customer, "/assistant/ask", "POST", { question: q })) });

const fixtures = {
  generated_at: new Date().toISOString(),
  note: "Exported from a running DataGuard AI stack using SYNTHETIC data. Demo mode only.",
  sessions: Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, v.user])),
  consents: (await call(T.customer, "/consents/me")).consents,
  consentHistory: (await call(T.customer, "/consents/me/history")).history,
  myRequests: (await call(T.customer, "/requests/me")).requests,
  allRequests: (await call(T.dpo, "/requests")).requests,
  kpis: await call(T.dpo, "/dashboard/kpis"),
  alerts: alertsList,
  alertDetails,
  incidents: incidentsList,
  incidentDetails,
  staff: (await call(T.dpo, "/users/staff")).users,
  users: (await call(T.admin, "/users")).users,
  accessLogs: (await call(T.dpo, "/access-logs?limit=150")).logs,
  forecast: { anomalies: await call(T.dpo, "/risk/forecast?metric=anomalies"), incidents: await call(T.dpo, "/risk/forecast?metric=incidents") },
  metrics: await call(T.dpo, "/metrics"),
  assistant,
  auditLogs: (await call(T.dpo, "/audit-logs?limit=1000")).logs,
};
writeFileSync(new URL("../src/demo/fixtures.json", import.meta.url), JSON.stringify(fixtures));
console.log(`wrote src/demo/fixtures.json: ${alertsList.length} alerts, ${incidentsList.length} incidents, ${fixtures.auditLogs.length} audit rows`);
