import { Building2, ShieldCheck } from "lucide-react";

const FEATURES = [
  "Secure httpOnly sessions + MFA", "SOC dashboard & threat rules", "MITRE ATT&CK-mapped alerts",
  "Phishing URL / email detector", "IR playbooks + NPC 72-h clock", "Hash-chained audit log",
];

/** Split-screen layout shared by the sign-in and sign-up pages. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
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
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Data protection and security operations, in one place.</h1>
          <p className="mt-4 text-slate-300">Consent and data-rights self-service for customers. Sign-in threat monitoring, explainable machine-learning alerts, incident playbooks and a tamper-evident audit trail for the team protecting that data.</p>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-sm text-slate-300">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />{f}</li>
            ))}
          </ul>
          <p className="mt-10 flex items-center gap-2 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" />Sample company “Acme Retail PH” · all records are synthetic · student capstone project</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12"><div className="w-full max-w-md">{children}</div></div>
    </div>
  );
}
