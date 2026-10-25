"use client";
import { CheckCircle2, KeyRound, LaptopMinimal, LogOut, ShieldCheck, ShieldOff, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAsync } from "@/lib/hooks";
import type { MfaSetup } from "@/lib/types";
import { LiveOnly, PasswordStrength, passwordOk, timeAgo } from "./security";
import { Badge, Button, Card, cx, Empty, ErrorBox, inputCls, Loading, PageHeader, Table, Td } from "./ui";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function MySecurity() {
  const sec = api.sec;
  if (!sec) return (<><PageHeader title="My security" description="Sign-in history, active sessions and two-step verification." /><LiveOnly feature="My security" /></>);
  return (
    <>
      <PageHeader title="My security" description="Check where your account is signed in, review recent sign-in attempts and turn on two-step verification (MFA)." />
      <div className="grid gap-6 xl:grid-cols-2">
        <MfaCard />
        <PasswordCard />
      </div>
      <div className="mt-6 space-y-6">
        <SessionsCard />
        <HistoryCard />
      </div>
    </>
  );
}

function MfaCard() {
  const sec = api.sec!;
  const { refresh } = useAuth();
  const st = useAsync(() => sec.mfaStatus(), []);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "regen">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const enabled = st.data?.enabled;
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-indigo-500" />Two-step verification (MFA)</span>}
      action={st.data && (enabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Off</Badge>)}
      subtitle="After your password, you also enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…).">
      {st.loading ? <Loading /> : st.error ? <ErrorBox error={st.error} /> : (
        <div className="space-y-4 text-sm">
          {codes && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-medium text-emerald-900">Save these backup codes now - they are shown only once.</p>
              <p className="mt-1 text-xs text-emerald-800">Each code works once if you lose your phone. Store them somewhere safe (not in the same place as your password).</p>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <span key={c} className="rounded bg-white px-2 py-1 text-center ring-1 ring-emerald-200">{c}</span>)}</div>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCodes(null)}>I saved them</Button>
            </div>
          )}
          {!enabled && !setup && (
            <>
              <p className="text-slate-600">MFA stops most account takeovers: a stolen or guessed password is no longer enough to sign in.</p>
              <Button disabled={busy} onClick={() => run(async () => setSetup(await sec.mfaSetup()))}><ShieldCheck className="h-4 w-4" />Set up MFA</Button>
            </>
          )}
          {!enabled && setup && (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg ring-1 ring-slate-200" />
              <div className="space-y-3">
                <ol className="list-decimal space-y-1 pl-4 text-slate-600">
                  <li>Open your authenticator app and scan the QR code.</li>
                  <li>Can&apos;t scan? Enter this key: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{setup.secret}</code></li>
                  <li>Type the 6-digit code it shows to confirm.</li>
                </ol>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => {
                  const r = await sec.mfaEnable(code); setCodes(r.backup_codes); setSetup(null); setCode(""); await st.reload(); await refresh(); }); }}>
                  <input className={cx(inputCls, "w-36! font-mono tracking-widest")} inputMode="numeric" placeholder="123456" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
                  <Button disabled={busy}>Confirm &amp; turn on</Button>
                </form>
              </div>
            </div>
          )}
          {enabled && mode === "idle" && (
            <>
              <p className="flex items-center gap-2 text-slate-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Your account asks for an authenticator code at every sign-in.</p>
              <p className="text-slate-500">{st.data!.backup_codes_remaining} unused backup code{st.data!.backup_codes_remaining === 1 ? "" : "s"} left.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setMode("regen")}>New backup codes</Button>
                <Button variant="ghost" size="sm" onClick={() => setMode("disable")}><ShieldOff className="h-4 w-4" />Turn off MFA</Button>
              </div>
            </>
          )}
          {enabled && mode !== "idle" && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (mode === "disable") { await sec.mfaDisable(pw, code); await refresh(); } else setCodes((await sec.mfaBackupCodes(pw, code)).backup_codes);
              setMode("idle"); setPw(""); setCode(""); await st.reload(); }); }}>
              <p className="text-slate-600">{mode === "disable" ? "Confirm with your password and a current code to turn MFA off." : "Confirm to replace all backup codes."}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={inputCls} type="password" placeholder="Current password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
                <input className={cx(inputCls, "font-mono")} placeholder="Authenticator code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <div className="flex gap-2">
                <Button disabled={busy} variant={mode === "disable" ? "danger" : "primary"} size="sm">{mode === "disable" ? "Turn off MFA" : "Generate new codes"}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </form>
          )}
          {err && <ErrorBox error={err} />}
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const sec = api.sec!;
  const { user } = useAuth();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [conf, setConf] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = [user?.name ?? "", user?.email ?? "", (user?.email ?? "").split("@")[0]];
  return (
    <Card title="Change password" subtitle="Changing your password signs you out everywhere else.">
      <form className="space-y-3 text-sm" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        if (next !== conf) return setMsg({ ok: false, text: "The new passwords don't match." });
        if (!(await passwordOk(next, inputs))) return setMsg({ ok: false, text: "Choose a stronger password (12+ characters, rated Strong)." });
        setBusy(true);
        try { const r = await sec.changePassword(cur, next); setMsg({ ok: true, text: `Password changed. ${r.other_sessions_revoked} other session(s) signed out.` }); setCur(""); setNext(""); setConf(""); }
        catch (e2) { setMsg({ ok: false, text: (e2 as Error).message }); } finally { setBusy(false); }
      }}>
        <input className={inputCls} type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <div>
          <input className={inputCls} type="password" placeholder="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <PasswordStrength password={next} userInputs={inputs} />
        </div>
        <input className={inputCls} type="password" placeholder="Confirm new password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} required />
        {msg && <p className={cx("rounded-lg px-3 py-2", msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{msg.text}</p>}
        <Button disabled={busy}>Update password</Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const sec = api.sec!;
  const s = useAsync(() => sec.sessions(), []);
  const [note, setNote] = useState<string | null>(null);
  const others = (s.data ?? []).filter((x) => !x.current).length;
  return (
    <Card title={<span className="flex items-center gap-2"><LaptopMinimal className="h-4 w-4 text-indigo-500" />Active sessions</span>}
      subtitle="Every browser where you're signed in. Don't recognise one? Sign it out and change your password."
      action={<Button variant="secondary" size="sm" disabled={!others} onClick={async () => { const n = await sec.revokeOtherSessions(); setNote(`Signed out ${n} other session(s).`); await s.reload(); }}>
        <LogOut className="h-4 w-4" />Sign out other sessions</Button>}>
      {note && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
      {s.loading ? <Loading /> : s.error ? <ErrorBox error={s.error} /> : (
        <Table head={["Device", "IP (masked)", "Signed in", "Last active", "MFA", ""]}>
          {s.data!.map((x) => (
            <tr key={x.id}>
              <Td><span className="font-medium text-slate-900">{x.device}</span>{x.current && <Badge tone="indigo" className="ml-2">This device</Badge>}</Td>
              <Td className="font-mono text-xs">{x.ip}</Td>
              <Td>{fmt(x.created_at)}</Td>
              <Td>{timeAgo(x.last_seen_at)}</Td>
              <Td>{x.mfa ? <Badge tone="green">verified</Badge> : <Badge tone="slate">password</Badge>}</Td>
              <Td className="text-right">{!x.current && <Button variant="ghost" size="sm" onClick={async () => { await sec.revokeSession(x.id); await s.reload(); }}>Sign out</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

const REASON: Record<string, string> = {
  ok: "Signed in", bad_password: "Wrong password", locked: "Account locked", mfa_failed: "Wrong MFA code", unknown_user: "Unknown account",
  inactive: "Account disabled", mfa_ok: "Signed in with MFA", rate_limited: "Too many attempts from this network",
};
function HistoryCard() {
  const sec = api.sec!;
  const h = useAsync(() => sec.loginHistory(), []);
  return (
    <Card title="Recent sign-in attempts" subtitle="Successful and failed attempts on your account. Locations are approximate (synthetic for this demo).">
      {h.loading ? <Loading /> : h.error ? <ErrorBox error={h.error} /> : !h.data!.length ? <Empty>No sign-in attempts yet.</Empty> : (
        <Table head={["When", "Result", "IP (masked)", "Location", "Device"]}>
          {h.data!.map((a) => (
            <tr key={a.id}>
              <Td>{fmt(a.ts)}</Td>
              <Td><span className="flex items-center gap-1.5">{a.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}{REASON[a.reason] ?? a.reason}</span></Td>
              <Td className="font-mono text-xs">{a.ip}{a.threat_match && <Badge tone="red" className="ml-2">listed IP</Badge>}</Td>
              <Td>{[a.city, a.country].filter(Boolean).join(", ") || "-"}</Td>
              <Td className="max-w-xs truncate text-xs text-slate-500">{a.user_agent}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
