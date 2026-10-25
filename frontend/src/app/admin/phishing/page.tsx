"use client";
import { Fish, Link2, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AttackBadge, LiveOnly } from "@/components/security";
import { Badge, Button, Card, cx, Empty, ErrorBox, inputCls, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { PhishingResult } from "@/lib/types";

const SAMPLES = {
  url: ["http://gcash-verify-account.xyz/login?session=8812", "https://www.bdo.com.ph/personal", "http://192.0.2.45/secure/bpi-update.php"],
  email: [
    "URGENT: Your GCash account will be suspended in 24 hours. Click here to verify your identity: http://gcash-secure.top/verify",
    "Hi team, attaching the minutes from Tuesday's meeting. Let me know if I missed anything. Thanks, Ana",
    "Congrats! Nanalo ka ng P50,000 sa aming raffle. I-claim na ngayon, i-send lang ang OTP mo sa link na ito.",
  ],
};
const LABEL = { phishing: { t: "Likely phishing", tone: "red" }, suspicious: { t: "Suspicious", tone: "amber" }, likely_legitimate: { t: "Likely legitimate", tone: "green" } } as const;

export default function PhishingPage() {
  const [kind, setKind] = useState<"url" | "email">("url");
  const [text, setText] = useState("");
  const [res, setRes] = useState<PhishingResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api.sec) return (<><PageHeader title="Phishing detector" /><LiveOnly feature="The phishing detector" /></>);

  const analyze = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try { setRes(await api.sec!.phishing(kind, text)); } catch (x) { setErr((x as Error).message); setRes(null); } finally { setBusy(false); }
  };
  const max = res ? Math.max(...res.top_features.map((f) => Math.abs(f.contribution)), 0.0001) : 1;
  const pct = res ? Math.round(res.probability * 100) : 0;

  return (
    <>
      <PageHeader title="Phishing detector" description="Paste a suspicious link or email. A machine-learning model estimates how likely it is to be phishing and shows which signals drove the score. Only a hash of what you paste is stored."
        actions={<AttackBadge id="T1566" />} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Check a link or message">
          <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
            {([["url", "URL", Link2], ["email", "Email / SMS text", Mail]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => { setKind(k); setRes(null); setText(""); }}
                className={cx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}><I className="h-4 w-4" />{l}</button>
            ))}
          </div>
          <form onSubmit={analyze} className="space-y-3">
            {kind === "url"
              ? <input className={cx(inputCls, "font-mono")} placeholder="https://example.com/login" value={text} onChange={(e) => setText(e.target.value)} required minLength={4} />
              : <textarea className={inputCls} rows={7} placeholder="Paste the email or SMS text…" value={text} onChange={(e) => setText(e.target.value)} required minLength={4} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy}><Fish className="h-4 w-4" />{busy ? "Analysing…" : "Analyse"}</Button>
              <span className="text-xs text-slate-500">Try a sample:</span>
              {SAMPLES[kind].map((s, i) => <button type="button" key={i} onClick={() => setText(s)} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">#{i + 1}</button>)}
            </div>
          </form>
          {err && <div className="mt-3"><ErrorBox error={err} /></div>}
          <p className="mt-4 text-xs text-slate-500">Never open a suspicious link to “test” it - paste it here instead. The detector reads the text only; it does not visit the site.</p>
        </Card>

        <Card title="Result" subtitle={res ? `Model: ${res.model}` : undefined}>
          {!res ? <Empty>Results appear here.</Empty> : (
            <div className="space-y-5 text-sm">
              <div className="flex items-center gap-5">
                <div className="relative grid h-24 w-24 place-items-center rounded-full" style={{ background: `conic-gradient(${pct >= 50 ? "#e11d48" : pct >= 30 ? "#f59e0b" : "#10b981"} ${pct * 3.6}deg, #e2e8f0 0deg)` }}>
                  <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-white text-xl font-bold text-slate-900">{pct}%</span>
                </div>
                <div>
                  <Badge tone={LABEL[res.label].tone}>{LABEL[res.label].t}</Badge>
                  <p className="mt-2 text-slate-600">Estimated probability of phishing. ≥50% = phishing, 30–50% = suspicious.</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Why? Top signals</p>
                <ul className="space-y-1.5">
                  {res.top_features.map((f, i) => (
                    <li key={i} className="grid grid-cols-[1fr_140px] items-center gap-3">
                      <span className="truncate font-mono text-xs text-slate-700">{f.feature}</span>
                      <span className="flex items-center gap-1.5">
                        <span className={cx("h-2 rounded-full", f.direction === "phishing" ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.max(4, (Math.abs(f.contribution) / max) * 100)}px` }} />
                        <span className="text-[11px] text-slate-500">{f.direction === "phishing" ? "+ phish" : "− legit"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{res.note} Test-set metrics on synthetic data: precision {res.model_metrics.precision ?? "-"}, recall {res.model_metrics.recall ?? "-"}, F1 {res.model_metrics.f1 ?? "-"} (<Link href="/admin/models" className="underline">details</Link>).</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
