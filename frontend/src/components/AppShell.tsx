"use client";
import {
  Activity, BarChart3, BrainCircuit, ClipboardList, FileLock2, Gauge, LogOut, MessageCircleQuestion, ScrollText,
  ShieldCheck, ShieldAlert, Users, FileSearch, Radar, Crosshair, Fish, ListChecks, UserRoundCog, ScanSearch,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { cx, Loading } from "./ui";

interface NavItem { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Role[]; section?: string }
const REVIEWERS: Role[] = ["dpo", "security", "admin"];

const CUSTOMER_NAV: NavItem[] = [
  { href: "/portal/consents", label: "My consents", icon: ShieldCheck, roles: ["customer"] },
  { href: "/portal/requests", label: "Data rights requests", icon: FileLock2, roles: ["customer"] },
  { href: "/portal/assistant", label: "Privacy assistant", icon: MessageCircleQuestion, roles: ["customer"] },
  { href: "/portal/scanner", label: "Website scanner", icon: ScanSearch, roles: ["customer"], section: "Stay safe online" },
  { href: "/portal/security", label: "My security", icon: UserRoundCog, roles: ["customer"], section: "Account" },
];
const STAFF_NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: Gauge, roles: ["dpo", "security", "admin", "executive"] },
  { href: "/admin/alerts", label: "Anomaly alerts", icon: ShieldAlert, roles: ["dpo", "security", "admin", "executive"] },
  { href: "/admin/incidents", label: "Incidents", icon: ClipboardList, roles: ["dpo", "security", "admin", "executive"] },
  { href: "/admin/requests", label: "Data rights requests", icon: FileSearch, roles: ["dpo", "admin"] },
  { href: "/admin/risk", label: "Risk analytics", icon: Activity, roles: ["dpo", "security", "admin", "executive"] },
  { href: "/admin/models", label: "Model performance", icon: BrainCircuit, roles: ["dpo", "security", "admin", "executive"] },
  { href: "/admin/access-logs", label: "Access logs", icon: BarChart3, roles: ["dpo", "security", "admin"] },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, roles: ["dpo", "security", "admin"] },
  { href: "/admin/users", label: "Users & roles", icon: Users, roles: ["admin"] },
  { href: "/admin/soc", label: "SOC dashboard", icon: Radar, roles: REVIEWERS, section: "Security operations" },
  { href: "/admin/threats", label: "Threats & sign-ins", icon: Crosshair, roles: REVIEWERS, section: "Security operations" },
  { href: "/admin/scanner", label: "Website scanner", icon: ScanSearch, roles: ["dpo", "security", "admin", "executive"], section: "Security operations" },
  { href: "/admin/phishing", label: "Phishing detector", icon: Fish, roles: REVIEWERS, section: "Security operations" },
  { href: "/admin/self-check", label: "Security self-check", icon: ListChecks, roles: REVIEWERS, section: "Security operations" },
  { href: "/admin/security", label: "My security", icon: UserRoundCog, roles: ["dpo", "security", "admin", "executive"], section: "Account" },
];
export const ROLE_LABEL: Record<Role, string> = { customer: "Customer", dpo: "Data Protection Officer", security: "Security analyst", admin: "System admin", executive: "Executive" };

export function AppShell({ area, children }: { area: "portal" | "admin"; children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [newAlerts, setNewAlerts] = useState(0);

  // Page-level RBAC (the API enforces the same rules): the most specific nav entry for this path decides.
  const navAll = area === "portal" ? CUSTOMER_NAV : STAFF_NAV;
  const route = navAll.filter((n) => n.href !== "/admin" && path.startsWith(n.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const allowed = user && (area === "portal" ? user.role === "customer" : user.role !== "customer") && (!route || route.roles.includes(user.role));
  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else if (!allowed) router.replace(homeFor(user.role));
  }, [ready, user, allowed, router]);

  // Real-time: SSE stream of new alerts (live mode). Shows a counter badge on the nav.
  useEffect(() => {
    if (area !== "admin" || !allowed) return;
    return api.onAlert(() => setNewAlerts((n) => n + 1));
  }, [area, allowed]);

  if (!ready || !user || !allowed) return <div className="p-10"><Loading /></div>;
  const nav = (area === "portal" ? CUSTOMER_NAV : STAFF_NAV).filter((n) => n.roles.includes(user.role));
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="w-64 shrink-0 bg-slate-900 text-slate-300">
      <div className="sticky top-0 flex h-screen flex-col">
        <Link href={homeFor(user.role)} className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow"><ShieldCheck className="h-5 w-5" /></span>
          <span>
            <span className="block text-sm font-semibold text-white">DataGuard AI</span>
            <span className="block text-[11px] text-slate-400">{area === "portal" ? "Customer privacy portal" : "Accountability console"}</span>
          </span>
        </Link>
        <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {nav.map((n, i) => (<div key={n.href}>
            {n.section && n.section !== nav[i - 1]?.section && (
              <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{n.section}</p>)}
            <Link key={n.href} href={n.href} onClick={() => n.href === "/admin/alerts" && setNewAlerts(0)}
              className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                isActive(n.href) ? "bg-slate-800 font-medium text-white" : "hover:bg-slate-800/60 hover:text-white")}>
              <n.icon className={cx("h-4 w-4", isActive(n.href) ? "text-cyan-300" : "text-slate-500")} />
              <span className="flex-1">{n.label}</span>
              {n.href === "/admin/alerts" && newAlerts > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">{newAlerts} new</span>}
            </Link>
          </div>))}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-white">
              {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="truncate text-[11px] text-slate-400">{ROLE_LABEL[user.role]}</p>
            </div>
            <button onClick={logout} title="Sign out" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      </aside>
      <main className="min-w-0 flex-1 bg-slate-50">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

