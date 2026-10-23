"use client";
import { AlertTriangle, ClipboardList, FileSearch, ShieldAlert, Info } from "lucide-react";
import Link from "next/link";
import { CategoryBars, TrendChart } from "@/components/charts";
import { AlertStatusBadge, Badge, Card, ErrorBox, Loading, PageHeader, RiskBadge, Stat, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

export default function Dashboard() {
  const { user } = useAuth();
  const k = useAsync(() => api.kpis());
  const f = useAsync(() => api.forecast("anomalies"));
  const alerts = useAsync(() => api.alerts("flagged_for_review"));
  if (k.error) return <ErrorBox error={k.error} />;
  if (!k.data) return <Loading />;
  const K = k.data.kpis;
  const reviewed = K.alerts_confirmed + K.alerts_false_positive;
  const level = f.data?.trend.risk_level;

  return (
    <>
      <PageHeader title={`Good day, ${user?.name.split(" ")[0]}`} description="Overview of customer-data risk at Acme Retail PH. Alerts are flagged for human review — they are signals to investigate, not findings of wrongdoing." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Alerts awaiting review" value={K.alerts_pending} tone="amber" icon={<ShieldAlert className="h-4 w-4" />} hint={`${reviewed} reviewed · ${K.alerts_confirmed} confirmed`} />
        <Stat label="Open incidents" value={K.incidents_open} tone="red" icon={<ClipboardList className="h-4 w-4" />} hint={`${K.incidents_total} total recorded`} />
        <Stat label="Pending data requests" value={K.requests_pending} tone="indigo" icon={<FileSearch className="h-4 w-4" />} hint={K.requests_overdue ? `${K.requests_overdue} overdue` : "None overdue"} />
        <Stat label="Reviewer precision" value={reviewed ? `${Math.round((100 * K.alerts_confirmed) / reviewed)}%` : "—"} tone="green" icon={<AlertTriangle className="h-4 w-4" />} hint="Confirmed ÷ reviewed alerts (human feedback)" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Anomaly alert trend" subtitle={f.data?.method}
          action={level && <Badge tone={level === "high" ? "red" : level === "elevated" ? "amber" : "green"}>Trend: {level}</Badge>}>
          {f.data ? <TrendChart data={f.data} height={260} /> : <Loading />}
        </Card>
        <Card title="Incidents by category" subtitle="Human-confirmed category, else ML suggestion">
          <CategoryBars data={k.data.incidents_by_category} />
        </Card>
      </div>

      <Card className="mt-6" title="Latest alerts flagged for review" action={<Link href="/admin/alerts" className="text-xs font-medium text-indigo-600 hover:underline">View all →</Link>}>
        {!alerts.data ? <Loading /> : (
          <Table head={["When", "Employee", "Role", "Activity", "Risk", "Status"]}>
            {alerts.data.slice(0, 6).map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(a.ts)}</Td>
                <Td><Link href={`/admin/alerts/${a.id}`} className="font-mono text-xs font-medium text-indigo-600 hover:underline">{a.employee_id}</Link></Td>
                <Td className="text-slate-600">{humanize(a.employee_role)}</Td>
                <Td className="text-slate-600">{a.records_accessed.toLocaleString()} records · {humanize(a.resource)}{a.export_flag ? " · export" : ""}</Td>
                <Td><RiskBadge score={a.risk_score} /></Td>
                <Td><AlertStatusBadge status={a.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400"><Info className="h-3.5 w-3.5" />Models were trained and evaluated on synthetic data; see Model performance for honest metrics and limitations.</p>
    </>
  );
}
