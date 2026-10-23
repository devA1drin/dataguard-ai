"use client";
import { History } from "lucide-react";
import { useState } from "react";
import { Badge, Card, ErrorBox, Loading, PageHeader, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { PURPOSE_INFO, fmtDate, fmtDateTime } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

export default function ConsentsPage() {
  const consents = useAsync(() => api.consents());
  const history = useAsync(() => api.consentHistory());
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(purpose: string, granted: boolean) {
    setBusy(purpose);
    try { await api.setConsent(purpose, granted); await Promise.all([consents.reload(), history.reload()]); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="My consents" description="Choose how Acme Retail PH may use your personal data. Each purpose is optional and you can withdraw consent at any time — changes take effect immediately and are recorded in your consent history." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Consent preferences" subtitle="Order fulfilment and legal obligations do not depend on consent and are not listed here.">
          {consents.loading && !consents.data ? <Loading /> : consents.error ? <ErrorBox error={consents.error} /> : (
            <ul className="divide-y divide-slate-100">
              {consents.data!.map((c) => (
                <li key={c.purpose} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">{PURPOSE_INFO[c.purpose]?.label ?? c.purpose}</p>
                      <Badge tone={c.granted ? "green" : "slate"}>{c.granted ? "Granted" : "Withdrawn"}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{PURPOSE_INFO[c.purpose]?.desc}</p>
                    <p className="mt-1 text-[11px] text-slate-400">Last changed {fmtDate(c.updated_at)}</p>
                  </div>
                  <button role="switch" aria-checked={c.granted} disabled={busy === c.purpose} onClick={() => toggle(c.purpose, !c.granted)}
                    className={cx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50", c.granted ? "bg-indigo-600" : "bg-slate-300")}>
                    <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", c.granted ? "left-[22px]" : "left-0.5")} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-slate-400" />Consent history</span>} subtitle="Every grant and withdrawal, newest first">
          {history.loading && !history.data ? <Loading /> : (
            <div className="max-h-[480px] overflow-y-auto pl-2"><ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {history.data?.map((h, i) => (
                <li key={i} className="relative">
                  <span className={cx("absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white", h.granted ? "bg-emerald-500" : "bg-slate-400")} />
                  <p className="text-sm text-slate-800"><span className="font-medium">{h.granted ? "Granted" : h.channel === "signup" ? "Declined" : "Withdrew"}</span> {PURPOSE_INFO[h.purpose]?.label.toLowerCase() ?? h.purpose}</p>
                  <p className="text-xs text-slate-500">{fmtDateTime(h.changed_at)} · via {h.channel}</p>
                </li>
              ))}
            </ol></div>
          )}
        </Card>
      </div>
    </>
  );
}
