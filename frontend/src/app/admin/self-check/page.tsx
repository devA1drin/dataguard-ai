"use client";
import { CheckCircle2, CircleAlert, Info, ScanSearch, XCircle } from "lucide-react";
import { useState } from "react";
import { LiveOnly } from "@/components/security";
import { Button, Card, cx, Empty, ErrorBox, inputCls, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { SelfCheckResult } from "@/lib/types";

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: XCircle, info: Info };
const TONE = { pass: "text-emerald-600", warn: "text-amber-500", fail: "text-rose-600", info: "text-slate-400" };
const GRADE = { A: "bg-emerald-500", B: "bg-emerald-500", C: "bg-amber-500", D: "bg-orange-500", F: "bg-rose-600" } as Record<string, string>;

export default function SelfCheckPage() {
  if (!api.sec) return (<><PageHeader title="Security self-check" /><LiveOnly feature="The security self-check" /></>);
  return <SelfCheck />;
}

function SelfCheck() {
  const t = useAsync(() => api.sec!.selfCheckTargets(), []);
  const [idx, setIdx] = useState(0);
  const [res, setRes] = useState<SelfCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scan = async () => { setBusy(true); setErr(null); try { setRes(await api.sec!.selfCheck(idx)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  return (
    <>
      <PageHeader title="Security self-check" description="Scans this deployment's own security headers, cookie flags and HTTPS setup, then explains each result in plain English. It only checks the allow-listed DataGuard URLs below." />
      <Card title="Target">
        {t.loading ? <Loading /> : t.error ? <ErrorBox error={t.error} /> : (
          <div className="flex flex-wrap gap-2">
            <select className={cx(inputCls, "max-w-md")} value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
              {t.data!.map((u, i) => <option key={u} value={i}>{u}</option>)}
            </select>
            <Button onClick={scan} disabled={busy}><ScanSearch className="h-4 w-4" />{busy ? "Scanning…" : "Run check"}</Button>
          </div>
        )}
        {err && <div className="mt-3"><ErrorBox error={err} /></div>}
      </Card>
      {!res ? <div className="mt-6"><Empty>Run a check to see the grade.</Empty></div> : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[260px_1fr]">
          <Card className="self-start text-center">
            <div className={cx("mx-auto grid h-28 w-28 place-items-center rounded-2xl text-6xl font-bold text-white shadow", GRADE[res.grade] ?? "bg-slate-500")}>{res.grade}</div>
            <p className="mt-3 text-2xl font-semibold text-slate-900">{res.score}/100</p>
            <p className="mt-1 break-all text-xs text-slate-500">{res.target}</p>
            <p className="text-xs text-slate-400">{new Date(res.scanned_at).toLocaleString("en-PH")}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              {(["pass", "warn", "fail"] as const).map((s) => <div key={s} className="rounded-lg bg-slate-50 py-2 ring-1 ring-slate-200"><p className={cx("text-lg font-semibold", TONE[s])}>{res.checks.filter((c) => c.status === s).length}</p><p className="capitalize text-slate-500">{s}</p></div>)}
            </div>
          </Card>
          <Card title="Checks">
            <ul className="divide-y divide-slate-100">
              {res.checks.map((c) => { const I = ICON[c.status]; return (
                <li key={c.key} className="flex gap-3 py-3 text-sm">
                  <I className={cx("mt-0.5 h-5 w-5 shrink-0", TONE[c.status])} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{c.label}</p>
                    <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{c.value}</p>
                    <p className="mt-1 text-slate-600">{c.tip}</p>
                  </div>
                </li>); })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
