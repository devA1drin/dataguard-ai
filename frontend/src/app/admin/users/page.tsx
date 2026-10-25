"use client";
import { Lock, Trash2, UserPlus } from "lucide-react";
import { PasswordStrength, passwordOk } from "@/components/security";
import { useState } from "react";
import { ROLE_LABEL } from "@/components/AppShell";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Table, Td, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["customer", "dpo", "security", "admin", "executive"];
const STAFF_ROLES = ROLES.filter((r) => r !== "customer");
const PERMS: [string, Role[]][] = [
  ["Manage own consents & requests", ["customer"]], ["Use privacy assistant", ROLES],
  ["Review alerts, manage incidents", ["dpo", "security", "admin"]], ["Handle data-rights requests", ["dpo", "admin"]],
  ["View audit log", ["dpo", "security", "admin"]], ["Manage users & roles", ["admin"]], ["View dashboards & metrics", ["dpo", "security", "admin", "executive"]],
  ["SOC, threats, phishing, self-check", ["dpo", "security", "admin"]], ["My security (sessions, MFA)", ROLES],
];

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useAsync(() => api.users());
  const [form, setForm] = useState({ email: "", full_name: "", role: "security" as Role, password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); await users.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  return (
    <>
      <PageHeader title="Users & roles" description="Role-based access control. Customers sign up themselves; staff accounts can only be created here by an admin. Every change is written to the audit log." />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Accounts">
          {users.error ? <ErrorBox error={users.error} /> : !users.data ? <Loading /> : (
            <Table head={["User", "Role", "Status", "MFA", "Last login", ""]}>
              {users.data.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <Td><p className="font-medium text-slate-900">{u.full_name}</p><p className="text-xs text-slate-500">{u.email}</p></Td>
                  <Td>{u.role === "customer" ? <Badge>Customer</Badge> : (
                    <select disabled={busy || u.id === me?.id} className={cx(inputCls, "w-48! py-1.5")} value={u.role} onChange={(e) => run(() => api.updateUser(u.id, { role: e.target.value as Role }))}>
                      {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>)}</Td>
                  <Td><div className="flex flex-wrap gap-1"><Badge tone={u.is_active ? "green" : "slate"}>{u.is_active ? "Active" : "Disabled"}</Badge>
                    {u.locked && <Badge tone="red"><Lock className="mr-1 inline h-3 w-3" />Locked</Badge>}</div></Td>
                  <Td>{u.mfa_enabled ? <Badge tone="green">On</Badge> : <Badge tone={u.role === "customer" ? "slate" : "amber"}>Off</Badge>}</Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(u.last_login_at)}</Td>
                  <Td>{u.id !== me?.id && <div className="flex justify-end gap-1">
                    {u.locked && api.sec && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api.sec!.unlockUser(u.id))}>Unlock</Button>}
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api.updateUser(u.id, { is_active: !u.is_active }))}>{u.is_active ? "Disable" : "Enable"}</Button>
                    {api.sec && <Button size="sm" variant="ghost" title="Delete account" disabled={busy} onClick={() => confirm(`Delete the account ${u.email}? Their records stay; the login is removed.`) && run(() => api.sec!.deleteUser(u.id))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Add staff account" subtitle="Share the initial password with the person privately (not by email); ask them to change it and turn on MFA under My security.">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (!(await passwordOk(form.password, [form.email, form.full_name, form.email.split("@")[0]]))) throw new Error("Choose a stronger initial password (12+ characters, rated Strong).");
              await api.createUser(form); setForm({ email: "", full_name: "", role: "security", password: "" }); }); }}>
              <input className={inputCls} placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required minLength={2} />
              <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <div>
                <input className={inputCls} type="password" autoComplete="new-password" placeholder="Initial password (12+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
                <PasswordStrength password={form.password} userInputs={[form.email, form.full_name]} />
              </div>
              {err && <ErrorBox error={err} />}
              <Button disabled={busy} className="w-full"><UserPlus className="h-4 w-4" />Create account</Button>
            </form>
          </Card>
          <Card title="Permission matrix">
            <table className="w-full text-xs">
              <thead><tr><th /> {ROLES.map((r) => <th key={r} className="p-1 font-medium capitalize text-slate-500">{r === "executive" ? "exec" : r}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">{PERMS.map(([p, rs]) => (
                <tr key={p}><td className="py-2 pr-2 text-slate-700">{p}</td>{ROLES.map((r) => <td key={r} className="text-center">{rs.includes(r) ? <span className="text-emerald-600">●</span> : <span className="text-slate-200">●</span>}</td>)}</tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
