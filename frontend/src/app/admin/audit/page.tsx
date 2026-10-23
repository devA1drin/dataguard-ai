"use client";
import { Link2, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Table, Td, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { ChainResult } from "@/lib/types";

const tone = (action: string) => action.startsWith("alert") ? "amber" : action.startsWith("incident") ? "violet" : action.startsWith("consent") ? "green"
  : action.startsWith("auth") ? "slate" : action.startsWith("user") ? "red" : "indigo";

export default function AuditPage() {
  const logs = useAsync(() => api.auditLogs());
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<ChainResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE = 25;
  const rows = logs.data?.filter((r) => !filter || `${r.action} ${r.actor_name ?? ""} ${r.entity_type} ${r.entity_id ?? ""}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

  async function verify() {
    setBusy(true);
    try { setResult(await api.verifyAudit()); await logs.reload(); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every mutating action. Each row stores SHA-256(previous hash + row content), so editing, deleting or reordering any row breaks the chain and is detected by verification."
        actions={<Button onClick={verify} disabled={busy}><Link2 className="h-4 w-4" />{busy ? "Verifying…" : "Verify hash chain"}</Button>} />
      {result && (
        <div className={`mb-6 flex items-center gap-3 rounded-xl border p-4 text-sm ${result.valid ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
          {result.valid ? <ShieldCheck className="h-5 w-5" /> : <ShieldX className="h-5 w-5" />}
          {result.valid ? <span><strong>Chain intact.</strong> All {result.checked} rows recomputed and matched.</span>
            : <span><strong>Tampering detected</strong> at row #{result.brokenAtId} ({result.reason}).</span>}
        </div>
      )}
      <Card title={<span className="whitespace-nowrap">{rows.length} entries</span>} action={<input className={`${inputCls} w-64!`} placeholder="Filter by action, actor, entity…" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }} />}>
        {logs.error ? <ErrorBox error={logs.error} /> : !logs.data ? <Loading /> : (
          <Table head={["#", "Time", "Actor", "Action", "Entity", "Details (PII-masked)", "Hash chain"]}>
            {rows.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-50">
                <Td className="text-slate-400 tabular-nums">{r.id}</Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(r.created_at)}</Td>
                <Td className="whitespace-nowrap"><span className="text-slate-800">{r.actor_name ?? (r.actor_role === "system" ? "System (scoring job)" : "—")}</span>{r.actor_role && <span className="block text-[11px] text-slate-400">{r.actor_role}</span>}</Td>
                <Td className="whitespace-nowrap"><Badge tone={tone(r.action)}>{r.action}</Badge></Td>
                <Td className="whitespace-nowrap text-xs text-slate-600">{r.entity_type}{r.entity_id && <span className="text-slate-400"> · {r.entity_id}</span>}</Td>
                <Td><code className="block max-w-[220px] truncate text-[11px] text-slate-500" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</code></Td>
                <Td className="whitespace-nowrap"><code className="block text-[11px] text-slate-500" title={`prev ${r.prev_hash}\nhash ${r.hash}`}><span className="text-slate-400">{r.prev_hash.slice(0, 8)}</span> → <span className="text-indigo-600">{r.hash.slice(0, 8)}</span></code></Td>
              </tr>
            ))}
          </Table>
        )}
        {rows.length > PAGE && (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
