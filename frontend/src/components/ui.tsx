import Link from "next/link";
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && <Link href={back.href} className="mb-2 inline-block text-xs font-medium text-indigo-600 hover:underline">← {back.label}</Link>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function Button({ children, variant = "primary", size = "md", className, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "success"; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm",
    danger: "bg-rose-600 text-white hover:bg-rose-500 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return <button {...props} className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", v, className)}>{children}</button>;
}

export function Stat({ label, value, hint, tone = "indigo", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "indigo" | "amber" | "red" | "green" | "slate"; icon?: ReactNode }) {
  const ring = { indigo: "bg-indigo-50 text-indigo-600", amber: "bg-amber-50 text-amber-600", red: "bg-rose-50 text-rose-600", green: "bg-emerald-50 text-emerald-600", slate: "bg-slate-100 text-slate-600" }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className={cx("rounded-lg p-2", ring)}>{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />{label}</div>;
}
export function ErrorBox({ error }: { error: string }) {
  return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          {head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 first:pl-0">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => <td className={cx("px-3 py-3 align-middle first:pl-0", className)}>{children}</td>;

export const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

// --- domain badges ---
export function RiskBadge({ score }: { score: number }) {
  const tone: Tone = score >= 0.8 ? "red" : score >= 0.65 ? "amber" : "blue";
  return <Badge tone={tone} className="tabular-nums">{(score * 100).toFixed(0)} / 100</Badge>;
}
export function AlertStatusBadge({ status }: { status: string }) {
  const m: Record<string, [Tone, string]> = { flagged_for_review: ["amber", "Flagged for review"], confirmed: ["red", "Confirmed"], false_positive: ["slate", "False positive"] };
  const [t, l] = m[status] ?? ["slate", status];
  return <Badge tone={t}>{l}</Badge>;
}
export function SeverityBadge({ severity }: { severity: string }) {
  const t: Record<string, Tone> = { low: "slate", medium: "blue", high: "amber", critical: "red" };
  return <Badge tone={t[severity] ?? "slate"}>{severity[0].toUpperCase() + severity.slice(1)}</Badge>;
}
export function StatusBadge({ status }: { status: string }) {
  const t: Record<string, Tone> = { open: "indigo", investigating: "amber", contained: "violet", resolved: "green", closed: "slate",
    submitted: "indigo", in_review: "amber", completed: "green", rejected: "red" };
  return <Badge tone={t[status] ?? "slate"}>{status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
      <span>Showing {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={(page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
