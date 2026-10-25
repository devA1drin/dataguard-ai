"use client";
import { AlertTriangle, CheckCircle2, ChevronDown, Globe, History, Info, Lock, ScanSearch, ShieldAlert, ShieldBan, ShieldCheck, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AttackBadge, LiveOnly } from "@/components/security";
import { Badge, Button, Card, cx, Empty, inputCls, PageHeader, Table, Td } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { ScanFinding, ScanResult, ScanRow, ScanSeverity, ScanVerdict } from "@/lib/types";

/**
 * Website Scanner UI (shared by /portal/scanner and /admin/scanner).
 * Everything the backend fetched from the scanned site is shown as plain TEXT only - the page is never rendered.
 */
const SAMPLES = ["https://www.google.com", "http://neverssl.com", "https://expired.badssl.com"];
const STEPS = ["Checking the address is safe to visit", "Looking up domain age & threat feeds", "Loading the page (static HTML only)", "Checking certificate, headers & forms", "Scoring"];
const VERDICT: Record<ScanVerdict, { tone: "green" | "amber" | "red"; color: string; icon: typeof ShieldCheck; text: string }> = {
  Safe: { tone: "green", color: "#10b981", icon: ShieldCheck, text: "No serious warning signs found. Still be careful with what you type into any site." },
  Suspicious: { tone: "amber", color: "#f59e0b", icon: ShieldQuestion, text: "Some warning signs. Don't enter passwords, OTPs or card numbers unless you are sure who runs this site." },
  Dangerous: { tone: "red", color: "#e11d48", icon: ShieldAlert, text: "Strong signs of phishing or malware. Do not enter any information. The security team has been alerted." },
};
const SEV_TONE: Record<ScanSeverity, "slate" | "blue" | "amber" | "red" | "violet"> = { info: "slate", low: "blue", medium: "amber", high: "red", critical: "violet" };
const SEV_LABEL: Record<ScanSeverity, string> = { info: "Info", low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const CAT_LABEL: Record<ScanFinding["category"], string> = {
  threat_feed: "Threat feeds", url: "Address (URL)", domain: "Domain", tls: "HTTPS certificate", redirects: "Redirects",
  content: "Page content", headers: "Security headers", ml: "AI model",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

function Gauge({ score, verdict }: { score: number; verdict: ScanVerdict }) {
  const c = VERDICT[verdict].color;
  return (
    <div className="relative grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${c} ${score * 3.6}deg, #334155 0deg)` }}>
      <span className="grid h-[104px] w-[104px] place-items-center rounded-full bg-slate-900 text-center">
        <span><span className="block text-3xl font-bold text-white">{score}</span><span className="text-[10px] uppercase tracking-wider text-slate-400">risk / 100</span></span>
      </span>
    </div>
  );
}

function FindingItem({ f }: { f: ScanFinding }) {
  const Icon = f.positive ? CheckCircle2 : f.severity === "info" ? Info : AlertTriangle;
  return (
    <li className="flex gap-3 py-3">
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", f.positive ? "text-emerald-500" : f.severity === "info" ? "text-slate-400" : ["high", "critical"].includes(f.severity) ? "text-rose-500" : "text-amber-500")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{f.title}</span>
          {f.positive ? <Badge tone="green">Good</Badge> : <Badge tone={SEV_TONE[f.severity]}>{SEV_LABEL[f.severity]}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{f.explanation}</p>
        {f.evidence && <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{f.evidence}</p>}
      </div>
    </li>
  );
}

function Result({ r }: { r: ScanResult }) {
  const v = VERDICT[r.verdict]; const VIcon = v.icon;
  const problems = r.findings.filter((f) => !f.positive && f.severity !== "info");
  const notes = r.findings.filter((f) => f.positive || f.severity === "info");
  const d = r.details;
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-6 rounded-xl bg-slate-900 p-6 text-white shadow-sm">
        <Gauge score={r.score} verdict={r.verdict} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 text-2xl font-semibold" style={{ color: v.color }}><VIcon className="h-6 w-6" />{r.verdict}</span>
            {r.verdict === "Dangerous" && <AttackBadge id="T1566" />}
          </div>
          <p className="break-all font-mono text-sm text-slate-300">{r.url}{r.final_url && r.final_url !== r.url && <> → {r.final_url}</>}</p>
          <p className="text-sm text-slate-300">{v.text}</p>
          <p className="text-xs text-slate-500">{problems.length} warning{problems.length === 1 ? "" : "s"} · scanned {fmt(r.created_at)} in {(d.duration_ms / 1000).toFixed(1)}s{d.ip ? ` · server ${d.ip}` : ""}
            {r.alert_id && <> · <Link href="/admin/threats" className="underline">security alert #{r.alert_id}</Link></>}</p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card title="Findings" subtitle="Worst first. Each one explains what it means in plain words.">
          {problems.length === 0 ? <p className="py-2 text-sm text-emerald-700">No warning signs found.</p> : <ul className="divide-y divide-slate-100">{problems.map((f) => <FindingItem key={f.id} f={f} />)}</ul>}
          {notes.length > 0 && (
            <details className="group mt-2 border-t border-slate-100 pt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-slate-600"><ChevronDown className="h-4 w-4 transition group-open:rotate-180" />Good signs & notes ({notes.length})</summary>
              <ul className="divide-y divide-slate-100">{notes.map((f) => <FindingItem key={f.id} f={f} />)}</ul>
            </details>
          )}
        </Card>
        <Card title="Technical details" subtitle="Shown as text only - the scanned page is never displayed or run.">
          <dl className="space-y-3 text-sm">
            <Row k="Page title">{d.page?.title ?? "-"}</Row>
            <Row k="HTTP status">{d.status ?? "not reachable"}{d.truncated && " (page cut at 2 MB)"}</Row>
            <Row k="Redirects">{d.redirects.length <= 1 ? "none" : <ol className="list-decimal space-y-0.5 pl-4">{d.redirects.map((h, i) => <li key={i} className="break-all font-mono text-xs">{h.status} {h.url}</li>)}</ol>}</Row>
            <Row k="Certificate">{!d.tls ? "no HTTPS" : <span className={d.tls.authorized ? "text-emerald-700" : "text-rose-700"}><Lock className="mr-1 inline h-3.5 w-3.5" />{d.tls.authorized ? "valid" : `invalid (${d.tls.error})`} · {d.tls.protocol} · {d.tls.issuer ?? "unknown issuer"}{d.tls.daysLeft !== null && ` · ${d.tls.daysLeft} days left`}</span>}</Row>
            <Row k="Domain">{d.domain.registrable ?? "-"}{d.domain.age_days !== null && ` · ${d.domain.age_days} days old`}{d.domain.registrar && ` · ${d.domain.registrar}`}</Row>
            <Row k="AI model">{d.ml ? `${Math.round(d.ml.probability * 100)}% phishing-like (${d.ml.label.replace("_", " ")})` : "unavailable"}</Row>
            {d.page && <Row k="Page facts">{d.page.forms} form(s), {d.page.passwordFields} password field(s), {d.page.scripts} script(s), {d.page.iframes} iframe(s)</Row>}
            <Row k="Headers">
              <ul className="space-y-0.5">{Object.entries(d.headers).map(([h, val]) => (
                <li key={h} className="flex gap-2 text-xs"><span className={val ? "text-emerald-600" : "text-slate-400"}>{val ? "✓" : "✗"}</span><span className="font-mono">{h}</span></li>))}</ul>
            </Row>
          </dl>
        </Card>
      </div>
    </div>
  );
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[110px_1fr] gap-3"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-slate-800">{children}</dd></div>);

export default function WebsiteScanner({ staff }: { staff: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<{ msg: string; blocked: boolean } | null>(null);
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const load = useCallback(() => { api.sec?.scans().then((r) => setRows(r.scans)).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1400);
    return () => clearInterval(t);
  }, [busy]);
  if (!api.sec) return (<><PageHeader title="Website scanner" /><LiveOnly feature="The website scanner" /></>);

  const scan = async (e?: React.FormEvent, target = url) => {
    e?.preventDefault(); if (!target.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.sec!.scanWebsite(target.trim())); load(); }
    catch (x) { setErr({ msg: (x as Error).message, blocked: x instanceof ApiError && x.status === 400 && /^(Blocked|Only http|Port )/.test((x as Error).message) }); load(); }
    finally { setBusy(false); }
  };
  const open = async (id: number) => {
    setErr(null); setBusy(false);
    try { setRes(await api.sec!.scan(id)); window.scrollTo({ top: 0, behavior: "smooth" }); } catch (x) { setErr({ msg: (x as Error).message, blocked: false }); }
  };

  return (
    <>
      <PageHeader title="Website scanner"
        description="Paste any web address. DataGuard visits the REAL live site from our server (you don't have to open it), checks it for phishing and security warning signs, and explains what it found in plain words."
        actions={<AttackBadge id="T1566" />} />
      <div className="space-y-6">
        <Card>
          <form onSubmit={scan} className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className={cx(inputCls, "pl-9 font-mono")} placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} required aria-label="Website address" />
            </div>
            <Button disabled={busy}><ScanSearch className="h-4 w-4" />{busy ? "Scanning…" : "Scan website"}</Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Try:</span>
            {SAMPLES.map((s) => <button type="button" key={s} disabled={busy} onClick={() => { setUrl(s); scan(undefined, s); }} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-200">{s.replace(/^https?:\/\//, "")}</button>)}
          </div>
          <p className="mt-3 text-xs text-slate-500">The scanner reads the page&apos;s HTML as text and never runs its scripts. Internal and private addresses are refused. Limit: 10 scans per minute.</p>
        </Card>

        {busy && (
          <Card>
            <ol className="space-y-2 text-sm">
              {STEPS.map((s, i) => (
                <li key={s} className={cx("flex items-center gap-2", i < step ? "text-emerald-700" : i === step ? "font-medium text-slate-900" : "text-slate-400")}>
                  {i < step ? <CheckCircle2 className="h-4 w-4" /> : i === step ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /> : <span className="h-4 w-4 rounded-full border-2 border-slate-200" />}{s}
                </li>))}
            </ol>
          </Card>
        )}

        {err && (err.blocked ? (
          <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
            <ShieldBan className="h-6 w-6 shrink-0 text-rose-600" />
            <div><p className="font-semibold">Scan refused for safety</p><p className="mt-1">{err.msg}</p>
              <p className="mt-2 text-xs text-rose-700">This protects our servers from being tricked into opening internal systems (called SSRF). The attempt was recorded in the audit log.</p></div>
          </div>) : <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{err.msg}</div>)}

        {res && <Result r={res} />}
        {!res && !busy && !err && <Empty>Paste a link above, or pick an example, to see its risk score and findings.</Empty>}

        <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-slate-400" />Recent scans</span>} subtitle={staff ? "All users' scans (staff view)" : "Only your own scans"}>
          {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <Empty>No scans yet.</Empty> : (
            <Table head={["When", "Website", "Verdict", "Score", "Warnings", ...(staff ? ["User"] : []), ""]}>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap text-xs text-slate-500">{fmt(s.created_at)}</Td>
                  <Td><span className="block max-w-md truncate font-mono text-xs">{s.url}</span></Td>
                  <Td><Badge tone={VERDICT[s.verdict].tone}>{s.verdict}</Badge></Td>
                  <Td className="font-semibold">{s.score}</Td>
                  <Td className="text-xs">{s.serious ? <span className="text-rose-600">{s.serious} serious</span> : "-"}</Td>
                  {staff && <Td className="text-xs">{s.user_name ?? "deleted user"}{s.user_role && <span className="ml-1 text-slate-400">({s.user_role})</span>}</Td>}
                  <Td><button onClick={() => open(s.id)} className="text-xs font-medium text-indigo-600 hover:underline">View</button></Td>
                </tr>))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
