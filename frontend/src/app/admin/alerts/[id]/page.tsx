"use client";
import { CheckCircle2, ShieldAlert, XCircle, Info } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ShapChart } from "@/components/charts";
import { AlertStatusBadge, Badge, Button, Card, ErrorBox, Loading, PageHeader, RiskBadge, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { AlertStatus } from "@/lib/types";

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const a = useAsync(() => api.alert(Number(id)), [id]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canReview = user && ["dpo", "security", "admin"].includes(user.role);

  async function review(status: AlertStatus) {
    setBusy(true);
    try { await api.reviewAlert(Number(id), status, note || undefined); setNote(""); await a.reload(); } finally { setBusy(false); }
  }
  async function openIncident() {
    const d = a.data!;
    setBusy(true);
    try {
      const r = await api.createIncident({ title: `Suspicious access by ${d.employee_id} (alert #${d.id})`, severity: d.risk_score >= 0.8 ? "high" : "medium", related_alert_id: d.id,
        description: `An employee account (${d.employee_id}, ${d.employee_role}) accessed ${d.records_accessed} customer records (${d.distinct_customers} distinct customers, ${d.resource})${d.export_flag ? " and exported the data" : ""} at ${d.hour_of_day}:00 without a documented reason. Created from anomaly alert #${d.id}; under investigation.` });
      router.push(`/admin/incidents/${r.incident.id}`);
    } finally { setBusy(false); }
  }

  if (a.error) return <ErrorBox error={a.error} />;
  if (!a.data) return <Loading />;
  const d = a.data;
  const facts: [string, React.ReactNode][] = [
    ["Event time (PH)", fmtDateTime(d.ts)], ["Employee (pseudonymous)", <span key="e" className="font-mono">{d.employee_id}</span>],
    ["Employee role", humanize(d.employee_role)], ["Resource", humanize(d.resource)], ["Hour of day", `${d.hour_of_day}:00`],
    ["Records accessed", d.records_accessed.toLocaleString()], ["Distinct customers", d.distinct_customers.toLocaleString()],
    ["Data export", d.export_flag ? "Yes" : "No"], ["Off-hours / weekend", `${d.off_hours ? "Yes" : "No"} / ${d.is_weekend ? "Yes" : "No"}`], ["Failed logins", d.failed_logins],
  ];

  return (
    <>
      <PageHeader back={{ href: "/admin/alerts", label: "All alerts" }} title={`Alert #${d.id}`}
        description="Flagged by the anomaly model for human review. The explanation shows which features of this access event pushed its score up or down."
        actions={<><RiskBadge score={d.risk_score} /><AlertStatusBadge status={d.status} /></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <div className="space-y-6">
          <Card title="Access event">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {facts.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>)}
            </dl>
          </Card>
          <Card title="Human review" subtitle="Required before any action is taken">
            {d.status !== "flagged_for_review" && (
              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
                <p><span className="font-medium">{humanize(d.status)}</span> by {d.reviewer ?? "—"} · {fmtDateTime(d.reviewed_at)}</p>
                {d.review_note && <p className="mt-1 text-slate-600">“{d.review_note}”</p>}
              </div>
            )}
            {canReview ? (
              <div className="space-y-3">
                <textarea className={`${inputCls} h-20`} placeholder="Review note (e.g. ticket reference, reason)…" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy} onClick={() => review("confirmed")}><CheckCircle2 className="h-4 w-4" />Confirm suspicious</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => review("false_positive")}><XCircle className="h-4 w-4" />False positive</Button>
                  <Button variant="ghost" disabled={busy} onClick={openIncident}><ShieldAlert className="h-4 w-4" />Open incident</Button>
                </div>
              </div>
            ) : <p className="text-sm text-slate-500">Your role has read-only access to alerts.</p>}
          </Card>
        </div>
        <Card title="Why was this flagged? (SHAP explanation)" subtitle={d.explanation?.summary}
          action={<Badge tone="indigo">Isolation Forest</Badge>}>
          {d.explanation ? (
            <>
              <ShapChart contributions={d.explanation.contributions} />
              <div className="mt-4 flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-600" />Pushes toward anomalous</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-600" />Pushes toward normal</span>
              </div>
              <p className="mt-4 flex gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />SHAP values (TreeExplainer) are contributions to the model&apos;s isolation score relative to the average event. They describe what the model reacted to, not intent. Context the model cannot see (approved tickets, scheduled jobs) must be checked by the reviewer.</p>
            </>
          ) : <p className="text-sm text-slate-500">No explanation stored.</p>}
        </Card>
      </div>
    </>
  );
}
