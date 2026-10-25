"use client";
import { AlarmClock, CheckSquare, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { Playbook } from "@/lib/types";
import { Badge, Button, Card, cx, ErrorBox, Loading } from "./ui";

const PHASES = [
  { key: "contain", label: "1 · Contain", hint: "Stop the damage spreading" },
  { key: "eradicate", label: "2 · Eradicate", hint: "Remove the cause" },
  { key: "recover", label: "3 · Recover", hint: "Restore normal service safely" },
  { key: "lessons", label: "4 · Lessons learned", hint: "Prevent it happening again" },
] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

/** Incident-response checklist; every tick is audited server-side. */
export function PlaybookPanel({ incidentId, canEdit }: { incidentId: number; canEdit: boolean }) {
  const sec = api.sec;
  const p = useAsync(() => (sec ? sec.playbook(incidentId) : Promise.resolve(null)), [incidentId]);
  const [busy, setBusy] = useState<string | null>(null);
  if (!sec) return null;
  if (p.error) return <ErrorBox error={p.error} />;
  if (!p.data) return <Card title="Response playbook"><Loading /></Card>;
  const pb = p.data;
  const set = async (f: () => Promise<Playbook>, key: string) => { setBusy(key); try { p.setData(await f()); } finally { setBusy(null); } };
  const pct = pb.progress.total ? Math.round((100 * pb.progress.done) / pb.progress.total) : 0;

  return (
    <>
      <NpcPanel pb={pb} canEdit={canEdit} onChange={(patch) => set(() => sec.setBreach(incidentId, patch), "breach")} busy={busy === "breach"} />
      <Card title={`Response playbook · ${pb.title}`} subtitle={pb.category ? "Checklist for this incident category. Each tick is written to the audit log." : "General checklist - confirm a category to get a specific one."}
        action={<span className="text-xs font-medium text-slate-600">{pb.progress.done}/{pb.progress.total} steps</span>}>
        <div className="mb-4 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} /></div>
        <div className="grid gap-4 md:grid-cols-2">
          {PHASES.map((ph) => (
            <div key={ph.key} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">{ph.label}</p>
              <p className="mb-2 text-[11px] text-slate-500">{ph.hint}</p>
              <ul className="space-y-1.5">
                {pb.steps.filter((s) => s.phase === ph.key).map((s) => (
                  <li key={s.key}>
                    <button disabled={!canEdit || busy !== null} onClick={() => set(() => sec.setPlaybookStep(incidentId, s.key, !s.completed), s.key)}
                      className="flex w-full items-start gap-2 text-left disabled:cursor-default">
                      {s.completed ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                      <span>
                        <span className={cx("block text-sm", s.completed ? "text-slate-400 line-through" : "text-slate-700")}>{s.text}</span>
                        {s.completed && s.completed_at && <span className="block text-[11px] text-slate-400">✓ {s.completed_by ?? "a deleted user"} · {fmt(s.completed_at)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function NpcPanel({ pb, canEdit, onChange, busy }: { pb: Playbook; canEdit: boolean; busy: boolean;
  onChange: (p: { personal_data_breach?: boolean; discovered_at?: string; npc_notified?: boolean }) => void }) {
  const now = useNow();
  const b = pb.breach;
  const left = b.deadline ? new Date(b.deadline).getTime() - now : null;
  const overdue = left !== null && left < 0 && !b.notified_at;
  const h = left !== null ? Math.floor(Math.abs(left) / 3600_000) : 0;
  const m = left !== null ? Math.floor((Math.abs(left) % 3600_000) / 60_000) : 0;
  const s = left !== null ? Math.floor((Math.abs(left) % 60_000) / 1000) : 0;
  const tone = b.notified_at ? "border-emerald-200 bg-emerald-50" : !b.personal_data_breach ? "border-slate-200 bg-white" : overdue || (left ?? 1e12) < 12 * 3600_000 ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50";

  return (
    <div className={cx("rounded-xl border p-5 shadow-sm", tone)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <AlarmClock className={cx("mt-0.5 h-5 w-5", b.personal_data_breach && !b.notified_at ? "text-rose-600" : "text-slate-400")} />
          <div>
            <p className="font-semibold text-slate-900">NPC breach notification (72 hours)</p>
            <p className="mt-0.5 max-w-xl text-xs text-slate-600">{b.rule}. If 100 or more people are affected, notification can&apos;t be delayed. This is a teaching aid, not legal advice.</p>
          </div>
        </div>
        {b.personal_data_breach && b.deadline && (
          <div className="text-right">
            {b.notified_at ? <Badge tone="green">NPC notified {fmt(b.notified_at)}</Badge> : (
              <>
                <p className={cx("font-mono text-3xl font-bold tabular-nums", overdue ? "text-rose-700" : "text-slate-900")}>
                  {overdue ? "-" : ""}{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
                </p>
                <p className="text-xs text-slate-600">{overdue ? "OVERDUE - notify now" : "left"} · deadline {fmt(b.deadline)}</p>
              </>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!b.personal_data_breach
            ? <Button size="sm" variant="danger" disabled={busy} onClick={() => onChange({ personal_data_breach: true, discovered_at: new Date().toISOString() })}>Mark as personal-data breach (start clock now)</Button>
            : <>
                {!b.notified_at && <Button size="sm" variant="success" disabled={busy} onClick={() => onChange({ npc_notified: true })}>Record: NPC notified</Button>}
                {b.notified_at && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ npc_notified: false })}>Undo notified</Button>}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ personal_data_breach: false })}>Not a personal-data breach</Button>
              </>}
        </div>
      )}
      {b.discovered_at && <p className="mt-2 text-[11px] text-slate-500">Breach discovered / reasonably believed: {fmt(b.discovered_at)}</p>}
    </div>
  );
}
