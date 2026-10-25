"use client";
import { AttackBadge } from "@/components/security";
import { accessAnomalyTechniques } from "@/lib/attack";
import Link from "next/link";
import { useState } from "react";
import { AlertStatusBadge, Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pager, RiskBadge, Table, Td, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { AlertStatus } from "@/lib/types";

const TABS: { key: AlertStatus | "all"; label: string }[] = [
  { key: "flagged_for_review", label: "Flagged for review" }, { key: "confirmed", label: "Confirmed" },
  { key: "false_positive", label: "False positive" }, { key: "all", label: "All" },
];

export default function AlertsPage() {
  const all = useAsync(() => api.alerts());
  const [tab, setTab] = useState<AlertStatus | "all">("flagged_for_review");
  const [sort, setSort] = useState<"risk" | "time">("risk");
  const [page, setPage] = useState(0);
  const PAGE = 15;
  const rows = (all.data?.filter((a) => tab === "all" || a.status === tab) ?? [])
    .sort((a, b) => (sort === "risk" ? b.risk_score - a.risk_score : b.ts.localeCompare(a.ts)));

  return (
    <>
      <PageHeader title="Anomaly alerts" description="Access events scored by the Isolation Forest model at or above the alert threshold. Each alert must be reviewed by a person and marked confirmed or false positive. Employees are identified by pseudonymous IDs." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex w-fit gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(0); }} className={cx("rounded-md px-3 py-1.5 font-medium transition", tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
            {t.label} {all.data && <span className="ml-1 text-xs text-slate-400">{all.data.filter((a) => t.key === "all" || a.status === t.key).length}</span>}
          </button>
        ))}
      </div>
      <select className={cx(inputCls, "w-56!")} value={sort} onChange={(e) => setSort(e.target.value as "risk" | "time")}>
        <option value="risk">Sort: highest risk first</option><option value="time">Sort: newest first</option>
      </select>
      </div>
      <Card>
        {all.error ? <ErrorBox error={all.error} /> : !all.data ? <Loading /> : !rows.length ? <Empty>No alerts in this view.</Empty> : (
          <Table head={["Alert", "Event time (PH)", "Employee", "Activity", "Top factors (SHAP)", "Risk", "Status"]}>
            {rows.slice(page * PAGE, (page + 1) * PAGE).map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/alerts/${a.id}`} className="font-medium text-indigo-600 hover:underline">#{a.id}</Link></Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(a.ts)}{a.off_hours ? <Badge tone="violet" className="ml-2">off-hours</Badge> : null}</Td>
                <Td><span className="font-mono text-xs">{a.employee_id}</span><span className="block text-xs text-slate-500">{humanize(a.employee_role)}</span></Td>
                <Td className="text-slate-600">{a.records_accessed.toLocaleString()} records · {a.distinct_customers.toLocaleString()} customers{a.export_flag ? <Badge tone="red" className="ml-2">export</Badge> : null}
                  <span className="mt-1 flex gap-1">{accessAnomalyTechniques(a.export_flag).map((t) => <AttackBadge key={t} id={t} compact />)}</span></Td>
                <Td className="max-w-xs text-xs text-slate-500">{a.summary?.replace("Main factors raising the score: ", "")}</Td>
                <Td><RiskBadge score={a.risk_score} /></Td>
                <Td><AlertStatusBadge status={a.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
      </Card>
    </>
  );
}
