"use client";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { attackUrl, TECHNIQUES } from "@/lib/attack";
import { cx } from "./ui";

/** MITRE ATT&CK technique badge that links to attack.mitre.org. */
export function AttackBadge({ id, compact }: { id: string | null | undefined; compact?: boolean }) {
  if (!id) return null;
  const name = TECHNIQUES[id] ?? "ATT&CK technique";
  return (
    <a href={attackUrl(id)} target="_blank" rel="noopener noreferrer" title={`MITRE ATT&CK ${id}: ${name}`}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white ring-1 ring-slate-700 hover:bg-slate-700">
      <span className="text-rose-300">ATT&CK</span>{id}{!compact && <span className="font-sans text-slate-300">· {name}</span>}
      <ExternalLink className="h-3 w-3 text-slate-400" />
    </a>
  );
}

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
const COLORS = ["bg-rose-500", "bg-orange-500", "bg-amber-400", "bg-emerald-500", "bg-emerald-600"];

/** Offline password strength meter (zxcvbn, loaded on demand - the password never leaves the browser). */
export function PasswordStrength({ password, userInputs = [] }: { password: string; userInputs?: string[] }) {
  const [res, setRes] = useState<{ score: number; warning: string; suggestions: string[] } | null>(null);
  const inputs = userInputs.join("|");
  useEffect(() => {
    let live = true;
    if (!password) { setRes(null); return; }
    void import("zxcvbn").then(({ default: zxcvbn }) => {
      if (!live) return;
      const r = zxcvbn(password.slice(0, 128), [...inputs.split("|").filter(Boolean), "dataguard", "password"]);
      setRes({ score: r.score, warning: r.feedback.warning, suggestions: r.feedback.suggestions });
    });
    return () => { live = false; };
  }, [password, inputs]);
  const len = password.length >= 12;
  const score = res?.score ?? 0;
  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => (
        <span key={i} className={cx("h-1.5 flex-1 rounded-full", password && score > i ? COLORS[score] : "bg-slate-200")} />))}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={cx("font-medium", !password ? "text-slate-400" : score >= 3 ? "text-emerald-700" : "text-rose-700")}>
          {password ? LABELS[score] : "Password strength"}
        </span>
        <span className={cx(len ? "text-emerald-700" : "text-slate-500")}>{len ? "✓" : "•"} at least 12 characters</span>
        <span className={cx(password && score >= 3 ? "text-emerald-700" : "text-slate-500")}>{password && score >= 3 ? "✓" : "•"} hard to guess (strong or better)</span>
      </div>
      {password && res && score < 3 && (res.warning || res.suggestions[0]) && (
        <p className="text-xs text-slate-500">{[res.warning, ...res.suggestions].filter(Boolean).slice(0, 2).join(" ")}</p>
      )}
    </div>
  );
}

export const passwordOk = async (pw: string, inputs: string[] = []) => {
  if (pw.length < 12) return false;
  const { default: zxcvbn } = await import("zxcvbn");
  return zxcvbn(pw.slice(0, 128), [...inputs, "dataguard", "password"]).score >= 3;
};

/** Notice for pages that need the live backend. */
export function LiveOnly({ feature }: { feature: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">{feature} is available in live mode.</p>
      <p className="mt-1">This page needs the real backend (sign-in records, sessions, ML service). Demo mode only replays pre-computed sample data.</p>
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
