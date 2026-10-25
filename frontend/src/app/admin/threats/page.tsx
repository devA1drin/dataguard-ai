"use client";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { Fragment, useState } from "react";
import { AttackBadge, LiveOnly } from "@/components/security";
import { AlertStatusBadge, Badge, Button, Card, cx, Empty, ErrorBox, inputCls, Loading, PageHeader, SeverityBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAsync } from "@/lib/hooks";
import { REASON_LABEL, RULE_LABEL } from "@/lib/labels";
import type { AlertStatus, SecurityAlert } from "@/lib/types";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
type Tab = "alerts" | "attempts" | "intel";

export default function ThreatsPage() {
  const [tab, setTab] = useState<Tab>("alerts");
  if (!api.sec) return (<><PageHeader title="Threats & sign-ins" /><LiveOnly feature="Threat monitoring" /></>);
  return (
    <>
      <PageHeader title="Threats & sign-ins" description="Detection rules run on every sign-in attempt: brute force, password spraying, impossible travel, new device and sample threat-intel matches. Each alert is mapped to MITRE ATT&CK." />
      <div className="mb-5 inline-flex rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {([["alerts", "Security alerts"], ["attempts", "Sign-in attempts"], ["intel", "Threat intel (sample)"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-md px-3 py-1.5 text-sm font-medium", tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900")}>{l}</button>
        ))}
      </div>
      {tab === "alerts" ? <Alerts /> : tab === "attempts" ? <Attempts /> : <Intel />}
    </>
  );
}

function Alerts() {
  const sec = api.sec!;
  const { user } = useAuth();
  const [status, setStatus] = useState<AlertStatus | "">("flagged_for_review");
  const a = useAsync(() => sec.securityAlerts(status || undefined), [status]);
  const [open, setOpen] = useState<SecurityAlert | null>(null);
  const [note, setNote] = useState("");
  const canReview = user && ["dpo", "security", "admin"].includes(user.role);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card title="Security alerts" action={
        <select className={cx(inputCls, "w-48!")} value={status} onChange={(e) => setStatus(e.target.value as AlertStatus | "")}>
          <option value="flagged_for_review">Awaiting review</option><option value="confirmed">Confirmed</option><option value="false_positive">False positive</option><option value="">All</option>
        </select>}>
        {a.loading ? <Loading /> : a.error ? <ErrorBox error={a.error} /> : !a.data!.length ? <Empty>No alerts in this view.</Empty> : (
          <Table head={["When", "Rule", "Alert", "Severity", "ATT&CK", "Status"]}>
            {a.data!.map((x) => (
              <tr key={x.id} onClick={() => { setOpen(x); setNote(x.review_note ?? ""); }} className={cx("cursor-pointer hover:bg-slate-50", open?.id === x.id && "bg-indigo-50/50")}>
                <Td className="whitespace-nowrap text-xs text-slate-600">{fmt(x.created_at)}</Td>
                <Td className="whitespace-nowrap text-xs">{RULE_LABEL[x.rule] ?? x.rule}</Td>
                <Td><span className="block max-w-sm truncate font-medium text-slate-800">{x.title}</span>{x.synthetic && <span className="text-[10px] uppercase tracking-wide text-slate-400">synthetic</span>}</Td>
                <Td><SeverityBadge severity={x.severity} /></Td>
                <Td><AttackBadge id={x.technique_id} compact /></Td>
                <Td><AlertStatusBadge status={x.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={open ? `Alert #${open.id}` : "Alert details"} className="self-start">
        {!open ? <Empty>Select an alert to see the evidence and review it.</Empty> : (
          <div className="space-y-4 text-sm">
            <div><p className="font-semibold text-slate-900">{open.title}</p><p className="mt-1 text-slate-600">{open.description}</p></div>
            <div className="flex flex-wrap gap-2"><SeverityBadge severity={open.severity} /><AttackBadge id={open.technique_id} /></div>
            <dl className="grid grid-cols-3 gap-y-1.5 text-xs">
              <dt className="text-slate-500">Account</dt><dd className="col-span-2 font-mono">{open.email ?? "-"}</dd>
              <dt className="text-slate-500">Source IP</dt><dd className="col-span-2 font-mono">{open.ip ?? "-"}</dd>
              {Object.entries(open.details ?? {}).slice(0, 8).map(([k, v]) => (<Fragment key={k}><dt className="text-slate-500">{k.replace(/_/g, " ")}</dt>
                <dd className="col-span-2 break-words font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></Fragment>))}
            </dl>
            {open.reviewer && <p className="text-xs text-slate-500">Reviewed by {open.reviewer}{open.reviewed_at ? ` · ${fmt(open.reviewed_at)}` : ""}</p>}
            {canReview && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <textarea className={inputCls} rows={2} placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" onClick={async () => { await sec.reviewSecurityAlert(open.id, "confirmed", note); setOpen(null); await a.reload(); }}>Confirm threat</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await sec.reviewSecurityAlert(open.id, "false_positive", note); setOpen(null); await a.reload(); }}>False positive</Button>
                </div>
                <p className="text-[11px] text-slate-400">Every review is written to the hash-chained audit log.</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Attempts() {
  const sec = api.sec!;
  const [result, setResult] = useState<"" | "failed" | "success">("");
  const [q, setQ] = useState(""); const [query, setQuery] = useState("");
  const a = useAsync(() => sec.loginAttempts(result || undefined, query || undefined), [result, query]);
  return (
    <Card title="Sign-in attempts" subtitle="Latest 200. IPs masked to /24; locations are synthetic (derived from the IP for this demo)."
      action={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className={cx(inputCls, "w-56! pl-8")} placeholder="Email or IP" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className={cx(inputCls, "w-36!")} value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
          <option value="">All results</option><option value="failed">Failed</option><option value="success">Successful</option></select>
      </form>}>
      {a.loading ? <Loading /> : a.error ? <ErrorBox error={a.error} /> : !a.data!.length ? <Empty>No matching attempts.</Empty> : (
        <Table head={["When", "Account", "Result", "IP", "Location", "Threat intel", "Device"]}>
          {a.data!.map((x) => (
            <tr key={x.id}>
              <Td className="whitespace-nowrap text-xs text-slate-600">{fmt(x.ts)}</Td>
              <Td className="font-mono text-xs">{x.email}{x.synthetic && <span className="ml-1.5 text-[10px] uppercase text-slate-400">syn</span>}</Td>
              <Td><span className="flex items-center gap-1.5 whitespace-nowrap text-xs">{x.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}{REASON_LABEL[x.reason] ?? x.reason}</span></Td>
              <Td className="font-mono text-xs">{x.ip}</Td>
              <Td className="whitespace-nowrap text-xs">{[x.city, x.country].filter(Boolean).join(", ") || "-"}</Td>
              <Td>{x.threat_match ? <Badge tone="red">{x.threat_match}</Badge> : <span className="text-slate-300">-</span>}</Td>
              <Td className="max-w-[220px] truncate text-xs text-slate-500">{x.user_agent}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Intel() {
  const t = useAsync(() => api.sec!.threatIntel(), []);
  return (
    <Card title="Threat-intelligence indicators" subtitle={t.data?.note}
      action={<Badge tone="amber">SAMPLE DATA</Badge>}>
      {t.loading ? <Loading /> : t.error ? <ErrorBox error={t.error} /> : (
        <Table head={["Indicator", "Category", "Confidence", "Hits", "Description", "Source"]}>
          {t.data!.indicators.map((i) => (
            <tr key={i.id}>
              <Td className="font-mono text-xs font-medium">{i.indicator}</Td>
              <Td><Badge tone="red">{i.category.replace(/_/g, " ")}</Badge></Td>
              <Td>{i.confidence}%</Td>
              <Td className="font-semibold">{i.hits}</Td>
              <Td className="max-w-sm text-xs text-slate-600">{i.description}</Td>
              <Td className="text-xs text-slate-500">{i.source}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
