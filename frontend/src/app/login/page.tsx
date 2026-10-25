"use client";
import { ArrowRight, Crown, KeyRound, Lock, ShieldAlert, ShieldCheck, User, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/AuthLayout";
import { Button, cx, inputCls } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/config";
import type { Role } from "@/lib/types";

// Demo mode only: explore as a role. There are no demo accounts or passwords.
const DEMO_ROLES: { role: Role; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { role: "customer", label: "Customer", desc: "Consents, data requests, assistant", icon: User },
  { role: "dpo", label: "Data Protection Officer", desc: "Review alerts, incidents, requests", icon: ShieldCheck },
  { role: "security", label: "Security analyst", desc: "Investigate anomalies", icon: ShieldAlert },
  { role: "admin", label: "System admin", desc: "Users, roles, audit log", icon: UserCog },
  { role: "executive", label: "Executive", desc: "Read-only risk overview", icon: Crown },
];

export default function LoginPage() {
  const { login, verifyMfa, demoLogin } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await login(email, password);
      if ("mfa_token" in r) { setMfaToken(r.mfa_token); setPassword(""); }
      else router.push(homeFor(r.role));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true); setError(null);
    try { const u = await verifyMfa(mfaToken, code); router.push(homeFor(u.role)); }
    catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (/expired|start again/i.test(msg)) { setMfaToken(null); setCode(""); }
    } finally { setBusy(false); }
  }
  async function pick(role: Role) { const u = await demoLogin(role); router.push(homeFor(u.role)); }

  return (
    <AuthLayout>
      {mfaToken ? (
        <>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><KeyRound className="h-5 w-5" /></span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Two-step verification</h2>
          <p className="mt-1 text-sm text-slate-500">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
          <form onSubmit={submitCode} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-700">Authentication code
              <input className={cx(inputCls, "mt-1 font-mono text-lg tracking-[0.3em]")} inputMode="text" autoComplete="one-time-code" autoFocus
                placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={9} />
            </label>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <Button className="w-full" disabled={busy}><ShieldCheck className="h-4 w-4" />{busy ? "Verifying…" : "Verify and sign in"}</Button>
            <button type="button" onClick={() => { setMfaToken(null); setCode(""); setError(null); }} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
              ← Use a different account
            </button>
          </form>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">{DEMO_MODE ? "Demo mode: choose a role to explore. No account or password needed." : "Welcome back. Sign in with your DataGuard account."}</p>

          {!DEMO_MODE && (
            <>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block text-sm font-medium text-slate-700">Email
                  <input className={cx(inputCls, "mt-1")} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label className="block text-sm font-medium text-slate-700">Password
                  <input className={cx(inputCls, "mt-1")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
                <Button className="w-full" disabled={busy}><Lock className="h-4 w-4" />{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
              <p className="mt-6 text-center text-sm text-slate-500">New customer? <Link href="/signup" className="font-medium text-indigo-600 hover:text-indigo-500">Create an account</Link></p>
              <p className="mt-8 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-slate-200">
                Staff accounts are created by an administrator. After 5 wrong passwords an account is locked for a few minutes, and every attempt is logged.
              </p>
            </>
          )}

          {DEMO_MODE && (
            <div className="mt-8 space-y-2">
              {DEMO_ROLES.map((r) => (
                <button key={r.role} onClick={() => pick(r.role)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:shadow">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><r.icon className="h-4 w-4" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-slate-900">{r.label}</span>
                    <span className="block text-xs text-slate-500">{r.desc}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </AuthLayout>
  );
}
