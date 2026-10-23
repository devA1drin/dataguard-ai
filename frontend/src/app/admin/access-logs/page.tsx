"use client";
import { useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Pager, RiskBadge, Table, Td } from "@/components/ui";
import { api, type SimulateResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, humanize } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

export default function AccessLogsPage() {
  const logs = useAsync(() => api.accessLogs());
  const [page, setPage] = useState(0);
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<SimulateResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const canSimulate = Boolean(api.simulate) && user && ["dpo", "security", "admin"].includes(user.role);
  const simulate = async () => {
    setBusy(true); setSimError(null);
    try { setSim(await api.simulate!(5, true)); setPage(0); await logs.reload(); }
    catch (e) { setSimError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Access logs" description="Most recent employee access events to customer data, with the risk score assigned by the scoring job. Employees appear as pseudonymous IDs."
        actions={canSimulate ? <Button disabled={busy} onClick={simulate}><Zap className="h-4 w-4" />{busy ? "Scoring…" : "Simulate 5 events"}</Button> : undefined} />
      {simError && <div className="mb-4"><ErrorBox error={simError} /></div>}
      {sim && (
        <Card className="mb-4">
          <p className="text-sm text-slate-700">
            Inserted {sim.inserted} synthetic events and scored {sim.scored} with the Isolation Forest.{" "}
            {sim.new_alerts.length
              ? <>{sim.new_alerts.length} flagged for human review:{" "}
                  {sim.new_alerts.map((a) => <Link key={a.id} className="mr-2 font-medium text-indigo-600 hover:underline" href={`/admin/alerts/${a.id}`}>alert #{a.id} (risk {a.risk_score.toFixed(2)})</Link>)}</>
              : "None reached the review threshold."}
          </p>
        </Card>
      )}
      <Card>
        {logs.error ? <ErrorBox error={logs.error} /> : !logs.data ? <Loading /> : (
          <Table head={["Time (PH)", "Employee", "Role", "Resource", "Records", "Customers", "Flags", "Risk"]}>
            {logs.data.slice(page * 25, page * 25 + 25).map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(l.ts)}</Td>
                <Td className="font-mono text-xs">{l.employee_id}</Td>
                <Td className="text-slate-600">{humanize(l.employee_role)}</Td>
                <Td className="text-slate-600">{humanize(l.resource)}</Td>
                <Td className="tabular-nums">{l.records_accessed.toLocaleString()}</Td>
                <Td className="tabular-nums">{l.distinct_customers.toLocaleString()}</Td>
                <Td className="space-x-1">{l.export_flag ? <Badge tone="red">export</Badge> : null}{l.off_hours ? <Badge tone="violet">off-hours</Badge> : null}{l.failed_logins ? <Badge tone="amber">{l.failed_logins} failed</Badge> : null}</Td>
                <Td>{l.risk_score == null ? <Badge>pending</Badge> : <RiskBadge score={l.risk_score} />}</Td>
              </tr>
            ))}
          </Table>
        )}
        {logs.data && <Pager page={page} pageSize={25} total={logs.data.length} onPage={setPage} />}
      </Card>
    </>
  );
}
