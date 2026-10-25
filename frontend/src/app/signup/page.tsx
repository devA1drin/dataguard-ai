"use client";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordStrength, passwordOk } from "@/components/security";
import { Button, cx, inputCls } from "@/components/ui";
import { homeFor, useAuth } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/config";

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = [name, email, email.split("@")[0]];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords don't match.");
    if (!(await passwordOk(password, inputs))) return setError("Please choose a stronger password (at least 12 characters and rated Strong).");
    setBusy(true);
    try { const u = await signup({ full_name: name, email, password }); router.push(homeFor(u.role)); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-1 text-sm text-slate-500">Customer accounts manage their own consents and data-privacy requests.</p>
      {DEMO_MODE ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Sign-up needs the live backend. In demo mode, <Link className="underline" href="/login">pick a role</Link> instead.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">Full name
            <input className={cx(inputCls, "mt-1")} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
          </label>
          <label className="block text-sm font-medium text-slate-700">Email
            <input className={cx(inputCls, "mt-1")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block text-sm font-medium text-slate-700">Password
            <input className={cx(inputCls, "mt-1")} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
            <PasswordStrength password={password} userInputs={inputs} />
          </label>
          <label className="block text-sm font-medium text-slate-700">Confirm password
            <input className={cx(inputCls, "mt-1")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <p className="text-xs text-slate-500">Tip: a passphrase of 3–4 unrelated words is easy to remember and hard to guess. The strength check runs in your browser; your password is only sent when you submit.</p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button className="w-full" disabled={busy}><UserPlus className="h-4 w-4" />{busy ? "Creating account…" : "Create account"}</Button>
          <p className="text-center text-sm text-slate-500">Already have an account? <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
