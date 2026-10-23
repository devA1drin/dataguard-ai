"use client";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, StatusBadge, Table, Td, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { DataRequest } from "@/lib/types";

export default function StaffRequestsPage() {
  const list = useAsync(() => api.allRequests());
  const [sel, setSel] = useState<DataRequest | null>(null);
  const [resp, setResp] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (r: DataRequest) => { setSel(r); setResp(r.response ?? ""); setNote(r.internal_note ?? ""); };
  async function save(status: DataRequest["status"]) {
    if (!sel?.id) return;
    setBusy(true);
    try { await api.updateRequest(sel.id, { status, response: resp || undefined, internal_note: note || undefined }); await list.reload(); setSel(null); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Data rights requests" description="Access, correction and deletion requests from customers. Responses are visible to the customer; internal notes are not." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          {list.error ? <ErrorBox error={list.error} /> : !list.data ? <Loading /> : (
            <Table head={["Reference", "Type", "Customer", "Status", "Submitted", "Due"]}>
              {list.data.map((r) => {
                const overdue = ["submitted", "in_review"].includes(r.status) && new Date(r.due_at) < new Date();
                return (
                  <tr key={r.reference} onClick={() => open(r)} className={cx("cursor-pointer hover:bg-slate-50", sel?.reference === r.reference && "bg-indigo-50/50")}>
                    <Td className="font-mono text-xs">{r.reference}</Td>
                    <Td className="capitalize">{r.type}</Td>
                    <Td className="text-slate-500">#{r.customer_id}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-slate-500">{fmtDate(r.created_at)}</Td>
                    <Td className={overdue ? "font-medium text-rose-600" : "text-slate-500"}>{fmtDate(r.due_at)}{overdue && <Badge tone="red" className="ml-1">overdue</Badge>}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        <Card title={sel ? `Handle ${sel.reference}` : "Select a request"}>
          {!sel ? <p className="text-sm text-slate-500">Click a request to respond.</p> : (
            <div className="space-y-3 text-sm">
              <p className="rounded-lg bg-slate-50 p-3 text-slate-700"><span className="font-medium capitalize">{sel.type}: </span>{sel.details}</p>
              <label className="block text-xs text-slate-500">Response to customer<textarea className={cx(inputCls, "mt-1 h-24")} value={resp} onChange={(e) => setResp(e.target.value)} /></label>
              <label className="block text-xs text-slate-500">Internal note (never shown to customer)<textarea className={cx(inputCls, "mt-1 h-16")} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => save("in_review")}>Mark in review</Button>
                <Button size="sm" variant="success" disabled={busy} onClick={() => save("completed")}>Complete</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => save("rejected")}>Reject</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
