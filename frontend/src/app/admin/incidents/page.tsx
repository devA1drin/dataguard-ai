"use client";
import { AttackBadge } from "@/components/security";
import { INCIDENT_TECHNIQUE } from "@/lib/attack";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, SeverityBadge, StatusBadge, Table, Td, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

const STATUSES = ["all", "open", "investigating", "contained", "resolved", "closed"];

export default function IncidentsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const list = useAsync(() => api.incidents());
  const [status, setStatus] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", severity: "medium" });
  const [busy, setBusy] = useState(false);
  const canEdit = user && ["dpo", "security", "admin"].includes(user.role);
  const rows = list.data?.filter((i) => status === "all" || i.status === status) ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const r = await api.createIncident(form); router.push(`/admin/incidents/${r.incident.id}`); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Incidents" description="Privacy and security incidents with ownership, status and corrective actions. New reports are auto-categorized by the text classifier; a reviewer confirms the final category."
        actions={canEdit && <Button onClick={() => setShowNew((v) => !v)}><Plus className="h-4 w-4" />Report incident</Button>} />
      {showNew && (
        <Card className="mb-6" title="Report an incident">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-[2fr_1fr]">
            <input className={inputCls} placeholder="Short title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} />
            <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{humanize(s)} severity</option>)}
            </select>
            <textarea className={cx(inputCls, "h-24 md:col-span-2")} placeholder="What happened? (used by the ML classifier to suggest a category)" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} required minLength={10} />
            <div className="md:col-span-2"><Button disabled={busy}>{busy ? "Saving…" : "Create incident"}</Button></div>
          </form>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition", status === s ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50")}>
            {humanize(s)} {list.data && <span className="opacity-70">({list.data.filter((i) => s === "all" || i.status === s).length})</span>}
          </button>
        ))}
      </div>
      <Card>
        {list.error ? <ErrorBox error={list.error} /> : !list.data ? <Loading /> : (
          <Table head={["#", "Title", "Category", "Severity", "Status", "Assignee", "Reported"]}>
            {rows.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td className="text-slate-400">{i.id}</Td>
                <Td><Link href={`/admin/incidents/${i.id}`} className="font-medium text-slate-900 hover:text-indigo-600">{i.title}</Link></Td>
                <Td>{i.final_category ? <Badge tone="green">{humanize(i.final_category)}</Badge>
                  : i.predicted_category ? <Badge tone="indigo">{humanize(i.predicted_category)} · ML {Math.round((i.category_confidence ?? 0) * 100)}%</Badge> : <Badge>Unclassified</Badge>}
                  {" "}<AttackBadge id={INCIDENT_TECHNIQUE[i.final_category ?? i.predicted_category ?? ""] ?? null} compact />
                  {i.personal_data_breach && !i.npc_notified_at && <Badge tone="red" className="ml-1">NPC 72h</Badge>}</Td>
                <Td><SeverityBadge severity={i.severity} /></Td>
                <Td><StatusBadge status={i.status} /></Td>
                <Td className="text-slate-600">{i.assignee ?? <span className="text-slate-400">Unassigned</span>}</Td>
                <Td className="whitespace-nowrap text-slate-500">{fmtDate(i.reported_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
