"use client";
import { Activity, Crosshair, Lock, Radar, ShieldAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AttackBadge, LiveOnly, timeAgo } from "@/components/security";
import { Badge, Button, Card, cx, ErrorBox, Loading, PageHeader, SeverityBadge, Stat, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAsync } from "@/lib/hooks";
import type { FeedItem } from "@/lib/types";

const GRADE_TONE: Record<string, string> = { A: "text-emerald-600", B: "text-emerald-600", C: "text-amber-600", D: "text-orange-600", F: "text-rose-600" };
const SEV_COLOR = { critical: "#e11d48", high: "#f97316", medium: "#f59e0b", low: "#94a3b8" } as const;

export default function SocPage() {
  if (!api.sec) return (<><PageHeader title="SOC dashboard" /><LiveOnly feature="The SOC dashboard" /></>);
  return <Soc />;
}

function Soc() {
  const sec = api.sec!;
  const { user } = useAuth();
  const o = useAsync(() => sec.socOverview(), []);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [sim, setSim] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try { const f = await sec.socFeed(); if (live) { setFeed(f.items); setUpdated(new Date()); } } catch { /* keep last */ }
    };
    void tick();
    const t = setInterval(tick, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [sec]);

  if (o.error) return <ErrorBox error={o.error} />;
  if (!o.data) return <Loading />;
  const d = o.data;
  const c = d.counts;
  const openSec = d.by_severity.reduce((s, x) => s + x.security, 0);
  const openMl = d.by_severity.reduce((s, x) => s + x.ml, 0);
  const canSim = user?.role === "security" || user?.role === "admin";

  return (
    <>
      <PageHeader title="Security operations (SOC)" description="Live view of sign-in threats, open alerts and overall security posture. Sample threat-intel and older sign-in attempts are synthetic."
        actions={canSim && (
          <Button variant="secondary" onClick={async () => {
            const r = await sec.simulateBruteForce();
            setSim(r.alert ? `Simulated 6 failed sign-ins from 192.0.2.13 → alert “${r.alert.title}” (${r.alert.technique_id}).` : "Simulated 6 failed sign-ins (alert deduplicated - one already exists in the last hour).");
            await o.reload();
          }}><Zap className="h-4 w-4" />Simulate brute-force attack</Button>)} />
      {sim && <p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-indigo-200">{sim} Rows are marked synthetic and target a non-existent account.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open security alerts" value={openSec} tone="red" icon={<ShieldAlert className="h-4 w-4" />} hint={`${c.open_high} high/critical · ${openMl} ML anomaly alerts`} />
        <Stat label="Failed sign-ins (24 h)" value={c.failed_24h} tone="amber" icon={<Lock className="h-4 w-4" />} hint={`${c.attempts_24h} attempts in total`} />
        <Stat label="From listed IPs (24 h)" value={c.threat_24h} tone="slate" icon={<Crosshair className="h-4 w-4" />} hint="Matched the sample threat-intel list" />
        <Stat label="Staff with MFA" value={`${c.staff_mfa}/${c.staff}`} tone="green" icon={<Radar className="h-4 w-4" />} hint={`${c.locked} account(s) locked now`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Security posture score" subtitle="Weighted checklist - each item shows how to improve it">
          <div className="flex items-end gap-3">
            <span className={cx("text-6xl font-bold tracking-tight", GRADE_TONE[d.posture.grade])}>{d.posture.grade}</span>
            <span className="pb-2 text-2xl font-semibold text-slate-700">{d.posture.score}<span className="text-base text-slate-400">/100</span></span>
          </div>
          <ul className="mt-4 space-y-3">
            {d.posture.components.map((p) => (
              <li key={p.key} title={p.tip}>
                <div className="flex justify-between text-xs"><span className="font-medium text-slate-700">{p.label}</span><span className="text-slate-500">{p.detail} · weight {p.weight}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={cx("h-1.5 rounded-full", p.value >= 80 ? "bg-emerald-500" : p.value >= 50 ? "bg-amber-400" : "bg-rose-500")} style={{ width: `${p.value}%` }} /></div>
                {p.value < 80 && <p className="mt-1 text-[11px] text-slate-500">Tip: {p.tip}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="xl:col-span-2" title="Failed vs successful sign-ins (14 days, PH time)">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={d.daily.map((x) => ({ ...x, label: x.day.slice(5) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="failed" name="Failed" stackId="a" fill="#f43f5e" />
              <Bar dataKey="ok" name="Successful" stackId="a" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Open alerts by severity</p>
            <div className="grid grid-cols-4 gap-3">
              {d.by_severity.map((s) => (
                <div key={s.severity} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center gap-1.5 text-xs font-medium capitalize text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[s.severity] }} />{s.severity}</div>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{s.security + s.ml}</p>
                  <p className="text-[11px] text-slate-500">{s.security} sign-in · {s.ml} ML access</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Top risky accounts (14 days)" action={<Link href="/admin/threats" className="text-xs font-medium text-indigo-600 hover:underline">All sign-ins →</Link>}>
          <Table head={["Account", "Failed", "OK", "Alerts"]}>
            {d.top_users.map((u) => (
              <tr key={u.email}><Td className="font-mono text-xs">{u.email}</Td><Td className="font-semibold text-rose-600">{u.failed}</Td><Td>{u.ok}</Td>
                <Td>{u.alerts ? <Badge tone="red">{u.alerts}</Badge> : <span className="text-slate-400">0</span>}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Top risky source IPs (14 days)" subtitle="IPs are masked to /24; 192.0.2.x is the RFC 5737 sample range">
          <Table head={["IP", "Failed", "Accounts tried", "Threat intel", "Geo"]}>
            {d.top_ips.map((i) => (
              <tr key={i.ip}><Td className="font-mono text-xs">{i.ip}</Td><Td className="font-semibold text-rose-600">{i.failed}</Td><Td>{i.accounts}</Td>
                <Td>{i.threat ? <Badge tone="red">{i.threat}</Badge> : <span className="text-slate-400">-</span>}</Td><Td>{i.country ?? "-"}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mt-6" title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-indigo-500" />Live event feed</span>}
        subtitle="Newest sign-ins, security alerts and ML access alerts. Refreshes every 10 seconds."
        action={updated && <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Updated {updated.toLocaleTimeString("en-PH")}</span>}>
        <ul className="divide-y divide-slate-100">
          {feed.slice(0, 15).map((f) => (
            <li key={`${f.kind}-${f.id}`} className="flex items-start gap-3 py-2.5 text-sm">
              <span className="w-16 shrink-0 pt-0.5 text-xs text-slate-400">{timeAgo(f.at)}</span>
              <span className="w-20 shrink-0"><SeverityBadge severity={f.severity} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">{f.title}</span>
                <span className="block truncate text-xs text-slate-500">{f.kind === "login" ? "Sign-in" : f.kind === "security_alert" ? "Security alert" : "ML access alert"} · {f.detail}</span>
              </span>
              {f.technique_id && <AttackBadge id={f.technique_id} compact />}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
