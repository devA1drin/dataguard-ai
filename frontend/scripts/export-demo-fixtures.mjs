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

// No shared demo passwords exist any more. Pass your OWN local accounts via env vars:
//   DG_ADMIN_EMAIL / DG_ADMIN_PASSWORD [/ DG_ADMIN_MFA_CODE]   an admin (create one with `npm run create-admin`)
//   DG_CUSTOMER_EMAIL / DG_CUSTOMER_PASSWORD                    optional; otherwise a throwaway customer is signed up
const env = (k) => process.env[k] || "";
if (!env("DG_ADMIN_EMAIL") || !env("DG_ADMIN_PASSWORD")) {
  console.error("Set DG_ADMIN_EMAIL and DG_ADMIN_PASSWORD (a local admin account). See README > First admin.");
  process.exit(1);
}

/** Minimal cookie session: keeps the session cookie + CSRF token like the browser does. */
class Session {
  cookie = ""; csrf = ""; user = null;
  async call(path, method = "GET", body) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (/dg_session=/.test(c)) this.cookie = c.split(";")[0];
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (data?.csrfToken) this.csrf = data.csrfToken;
    if (data?.user) this.user = data.user;
    return data;
  }
  async login(email, password, mfaCode) {
    const r = await this.call("/auth/login", "POST", { email, password });
    if (r.mfa_required) {
      if (!mfaCode) throw new Error(`${email} has MFA on: set DG_ADMIN_MFA_CODE to a current code`);
      await this.call("/auth/mfa/verify", "POST", { mfa_token: r.mfa_token, code: mfaCode });
    }
    return this;
  }
}

const admin = await new Session().login(env("DG_ADMIN_EMAIL"), env("DG_ADMIN_PASSWORD"), env("DG_ADMIN_MFA_CODE"));
const customer = new Session();
if (env("DG_CUSTOMER_EMAIL")) await customer.login(env("DG_CUSTOMER_EMAIL"), env("DG_CUSTOMER_PASSWORD"));
else await customer.call("/auth/signup", "POST", {
  full_name: "Sample Customer (export)", email: `export.${Date.now()}@sample.dataguard.example`,
  password: `Export-${crypto.randomUUID()}-Fixture`,
});
// Admin can do everything the DPO / security / executive roles can, so one staff session is enough.
const S = { customer, dpo: admin, security: admin, admin, executive: admin };
const call = (who, ...rest) => who.call(...rest);
const T = S;
const sessionUsers = {
  customer: customer.user,
  dpo: { ...admin.user, role: "dpo", full_name: "Sample DPO" },
  security: { ...admin.user, role: "security", full_name: "Sample Security Analyst" },
  admin: admin.user,
  executive: { ...admin.user, role: "executive", full_name: "Sample Executive" },
};

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
  await call(T.admin, "/users", "POST", { email: `mika.security.${Date.now()}@sample.dataguard.example`, full_name: "Mika Torres (Security)", role: "security", password: `Tmp-${crypto.randomUUID()}` });
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
  sessions: sessionUsers,
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
