"use client";
import { CheckCircle2, Eraser, FileDown, PencilLine } from "lucide-react";
import { useState } from "react";
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { DataRequest } from "@/lib/types";

const TYPES: { type: DataRequest["type"]; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "access", label: "Access my data", desc: "Get a copy of the personal data we hold about you.", icon: FileDown },
  { type: "correction", label: "Correct my data", desc: "Fix inaccurate or outdated information.", icon: PencilLine },
  { type: "deletion", label: "Delete my data", desc: "Ask us to erase or anonymize your data.", icon: Eraser },
];
const STEPS = ["submitted", "in_review", "completed"] as const;

export default function RequestsPage() {
  const reqs = useAsync(() => api.myRequests());
  const [type, setType] = useState<DataRequest["type"]>("access");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.createRequest(type, details); setDone(r.reference); setDetails(""); await reqs.reload(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Data rights requests" description="Exercise your rights as a data subject. We aim to respond within 15 working days and you can track progress here." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card title="New request">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-2">
              {TYPES.map((t) => (
                <label key={t.type} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition", type === t.type ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500" : "border-slate-200 hover:border-slate-300")}>
                  <input type="radio" name="type" className="sr-only" checked={type === t.type} onChange={() => setType(t.type)} />
                  <t.icon className={cx("mt-0.5 h-4 w-4", type === t.type ? "text-indigo-600" : "text-slate-400")} />
                  <span><span className="block text-sm font-medium text-slate-900">{t.label}</span><span className="block text-xs text-slate-500">{t.desc}</span></span>
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium text-slate-700">Details
              <textarea className={cx(inputCls, "mt-1 h-24")} value={details} onChange={(e) => setDetails(e.target.value)} minLength={5} required
                placeholder="Describe what you need, e.g. which information should be corrected." />
            </label>
            {error && <ErrorBox error={error} />}
            {done && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Request {done} submitted.</p>}
            <Button disabled={busy} className="w-full">{busy ? "Submitting…" : "Submit request"}</Button>
          </form>
        </Card>
        <Card title="My requests" subtitle="Reference numbers and current status">
          {reqs.loading && !reqs.data ? <Loading /> : reqs.error ? <ErrorBox error={reqs.error} /> : !reqs.data!.length ? <Empty>No requests yet.</Empty> : (
            <ul className="space-y-3">
              {reqs.data!.map((r) => {
                const step = r.status === "rejected" ? 2 : STEPS.indexOf(r.status as (typeof STEPS)[number]);
                return (
                  <li key={r.reference} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">{r.reference}</span><span className="text-sm font-medium capitalize">{r.type}</span></div>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{r.details}</p>
                    <div className="mt-3 flex items-center gap-1">
                      {STEPS.map((s, i) => <div key={s} className={cx("h-1.5 flex-1 rounded-full", i <= step ? (r.status === "rejected" ? "bg-rose-400" : "bg-indigo-500") : "bg-slate-200")} />)}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate-400"><span>Submitted {fmtDate(r.created_at)}</span><span>Target date {fmtDate(r.due_at)}</span></div>
                    {r.response && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700"><span className="font-medium">Response: </span>{r.response}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
