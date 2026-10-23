"use client";
import { BrainCircuit, CheckSquare, MessageSquare, Square, UserCheck, ArrowRightLeft, Wrench } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, SeverityBadge, StatusBadge, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

const STATUSES = ["open", "investigating", "contained", "resolved", "closed"];
const CATEGORIES = ["unauthorized_access", "data_leak", "phishing", "misconfiguration", "policy_violation", "lost_device"];
const ICON: Record<string, React.ComponentType<{ className?: string }>> = { note: MessageSquare, corrective_action: Wrench, status_change: ArrowRightLeft, assignment: UserCheck };

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const d = useAsync(() => api.incident(Number(id)), [id]);
  const staff = useAsync(() => (user && user.role !== "executive" ? api.staff() : Promise.resolve([])), [user?.role]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"note" | "corrective_action">("note");
  const [busy, setBusy] = useState(false);
  const canEdit = !!user && ["dpo", "security", "admin"].includes(user.role);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await d.reload(); } finally { setBusy(false); } };

  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const { incident: inc, actions, classification: cls } = d.data;
  const corrective = actions.filter((a) => a.action_type === "corrective_action");

  return (
    <>
      <PageHeader back={{ href: "/admin/incidents", label: "All incidents" }} title={inc.title}
        description={<>Incident #{inc.id} · reported {fmtDateTime(inc.reported_at)}{inc.reporter && ` by ${inc.reporter}`}{inc.related_alert_id && <> · from <Link className="text-indigo-600 hover:underline" href={`/admin/alerts/${inc.related_alert_id}`}>alert #{inc.related_alert_id}</Link></>}</>}
        actions={<><SeverityBadge severity={inc.severity} /><StatusBadge status={inc.status} /></>} />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card title="Description"><p className="text-sm leading-relaxed text-slate-700">{inc.description}</p></Card>
          <Card title="Corrective actions" subtitle={`${corrective.filter((a) => a.completed).length} of ${corrective.length} completed`}>
            {!corrective.length ? <p className="text-sm text-slate-500">No corrective actions yet.</p> : (
              <ul className="space-y-2">
                {corrective.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                    <button disabled={!canEdit || busy} onClick={() => run(() => api.toggleAction(inc.id, a.id, !a.completed))} className="mt-0.5 text-indigo-600 disabled:opacity-50">
                      {a.completed ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                    <div className="flex-1"><p className={cx("text-sm", a.completed && "text-slate-400 line-through")}>{a.content}</p><p className="text-[11px] text-slate-400">{a.actor} · {fmtDateTime(a.created_at)}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Activity timeline">
            <ol className="space-y-4">
              {actions.map((a) => { const I = ICON[a.action_type] ?? MessageSquare; return (
                <li key={a.id} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100"><I className="h-3.5 w-3.5 text-slate-500" /></span>
                  <div><p className="text-sm text-slate-800">{a.content}</p><p className="text-[11px] text-slate-400">{humanize(a.action_type)} · {a.actor ?? "system"} · {fmtDateTime(a.created_at)}</p></div>
                </li>
              ); })}
              {!actions.length && <p className="text-sm text-slate-500">No activity yet.</p>}
            </ol>
            {canEdit && (
              <form className="mt-5 space-y-2 border-t border-slate-100 pt-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.addAction(inc.id, kind, text); setText(""); }); }}>
                <div className="flex gap-2 text-xs">
                  {(["note", "corrective_action"] as const).map((k) => <button type="button" key={k} onClick={() => setKind(k)} className={cx("rounded-full px-3 py-1 font-medium ring-1 ring-inset", kind === k ? "bg-indigo-600 text-white ring-indigo-600" : "ring-slate-300 text-slate-600")}>{humanize(k)}</button>)}
                </div>
                <textarea className={cx(inputCls, "h-20")} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "note" ? "Add an investigation note…" : "Describe a corrective action to track…"} required minLength={2} />
                <Button size="sm" disabled={busy}>Add {humanize(kind).toLowerCase()}</Button>
              </form>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Ownership & status">
            <div className="space-y-3 text-sm">
              <label className="block"><span className="text-xs text-slate-500">Assigned to</span>
                <select className={cx(inputCls, "mt-1")} disabled={!canEdit || busy} value={inc.assigned_to ?? ""} onChange={(e) => run(() => api.updateIncident(inc.id, { assigned_to: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Unassigned</option>
                  {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  {!staff.data?.length && inc.assignee && <option value={inc.assigned_to ?? ""}>{inc.assignee}</option>}
                </select></label>
              <label className="block"><span className="text-xs text-slate-500">Status</span>
                <select className={cx(inputCls, "mt-1")} disabled={!canEdit || busy} value={inc.status} onChange={(e) => run(() => api.updateIncident(inc.id, { status: e.target.value }))}>
                  {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-slate-500">Severity</span>
                <select className={cx(inputCls, "mt-1")} disabled={!canEdit || busy} value={inc.severity} onChange={(e) => run(() => api.updateIncident(inc.id, { severity: e.target.value }))}>
                  {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-slate-500">Confirmed category (human)</span>
                <select className={cx(inputCls, "mt-1")} disabled={!canEdit || busy} value={inc.final_category ?? ""} onChange={(e) => e.target.value && run(() => api.updateIncident(inc.id, { final_category: e.target.value }))}>
                  <option value="">Not confirmed yet</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </select></label>
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-indigo-500" />ML category suggestion</span>} subtitle="TF-IDF text features · two models compared">
            {!cls ? <p className="text-sm text-slate-500">No classification available.</p> : (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-indigo-50 p-3">
                  <div><p className="text-xs text-indigo-700">Suggested category</p><p className="font-semibold text-indigo-900">{humanize(cls.category)}</p></div>
                  <Badge tone={cls.agree ? "green" : "amber"}>{cls.agree ? "Models agree" : "Models disagree"}</Badge>
                </div>
                {Object.entries(cls.models).map(([name, m]) => (
                  <div key={name}>
                    <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-700">{humanize(name)}{name === cls.selected_model && <Badge tone="indigo">serving</Badge>}</p>
                    {m.top3.map((t) => (
                      <div key={t.category} className="mb-1 flex items-center gap-2 text-xs">
                        <span className="w-36 truncate text-slate-600">{humanize(t.category)}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${t.p * 100}%` }} /></span>
                        <span className="w-10 text-right tabular-nums text-slate-500">{(t.p * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">Suggestion only — a reviewer sets the confirmed category.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
