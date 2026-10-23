"use client";
import { ArrowRight, Building2, Crown, Lock, ShieldAlert, ShieldCheck, User, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx, inputCls } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/config";
import type { Role } from "@/lib/types";

const DEMO_ROLES: { role: Role; email: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { role: "customer", email: "customer@dataguard.demo", label: "Customer", desc: "Consents, data requests, assistant", icon: User },
  { role: "dpo", email: "dpo@dataguard.demo", label: "Data Protection Officer", desc: "Review alerts, incidents, requests", icon: ShieldCheck },
  { role: "security", email: "security@dataguard.demo", label: "Security analyst", desc: "Investigate anomalies", icon: ShieldAlert },
  { role: "admin", email: "admin@dataguard.demo", label: "System admin", desc: "Users, roles, audit log", icon: UserCog },
  { role: "executive", email: "exec@dataguard.demo", label: "Executive", desc: "Read-only risk overview", icon: Crown },
];

export default function LoginPage() {
  const { login, demoLogin } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("dpo@dataguard.demo");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const u = await login(email, password); router.push(homeFor(u.role)); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function pick(role: Role, mail: string) {
    if (DEMO_MODE) { const u = await demoLogin(role); router.push(homeFor(u.role)); }
    else { setEmail(mail); setPassword("DemoPass123!"); }
  }

  return (
    <div className="grid min-h-screen flex-1 lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-slate-900 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400"><ShieldCheck className="h-5 w-5" /></span>
          <span className="text-lg font-semibold">DataGuard AI</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Customer data protection with accountability built in.</h1>
          <p className="mt-4 text-slate-300">Consent and data-rights self-service for customers. Machine-learning anomaly detection, explainable alerts and a tamper-evident audit trail for the people responsible for protecting that data.</p>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-sm text-slate-300">
            {["Isolation Forest + SHAP explanations", "Incident text classification", "Retrieval-grounded privacy assistant", "Hash-chained audit log"].map((f) => (
              <li key={f} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />{f}</li>
            ))}
          </ul>
          <p className="mt-10 flex items-center gap-2 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" />Sample company “Acme Retail PH” · all data is synthetic · student portfolio project</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">{DEMO_MODE ? "Demo mode: choose a role to explore. No password needed." : "Use one of the seeded demo accounts below (demo only)."}</p>

          {!DEMO_MODE && (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700">Email
                <input className={cx(inputCls, "mt-1")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="block text-sm font-medium text-slate-700">Password
                <input className={cx(inputCls, "mt-1")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              <Button className="w-full" disabled={busy}><Lock className="h-4 w-4" />{busy ? "Signing in…" : "Sign in"}</Button>
            </form>
          )}

          <div className="mt-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">{DEMO_MODE ? "Continue as" : "Demo accounts (click to fill)"}</p>
            <div className="space-y-2">
              {DEMO_ROLES.map((r) => (
                <button key={r.role} onClick={() => pick(r.role, r.email)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:shadow">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><r.icon className="h-4 w-4" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-slate-900">{r.label}</span>
                    <span className="block text-xs text-slate-500">{DEMO_MODE ? r.desc : r.email}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
