"use client";
import { useState } from "react";
import { TrendChart } from "@/components/charts";
import { Badge, Card, ErrorBox, Loading, PageHeader, Stat, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";

export default function RiskPage() {
  const [metric, setMetric] = useState<"anomalies" | "incidents">("anomalies");
  const f = useAsync(() => api.forecast(metric), [metric]);
  const t = f.data?.trend;
  return (
    <>
      <PageHeader title="Risk analytics" description="Daily counts with a 7-day rolling average and a simple linear trend projected 14 days ahead. This is explainable trend analysis to support planning — not a precise prediction."
        actions={<div className="flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
          {(["anomalies", "incidents"] as const).map((m) => <button key={m} onClick={() => setMetric(m)} className={cx("rounded-md px-3 py-1.5 font-medium", metric === m ? "bg-white shadow-sm" : "text-slate-600")}>{m === "anomalies" ? "Anomaly alerts" : "Incidents"}</button>)}
        </div>} />
      {f.error ? <ErrorBox error={f.error} /> : !f.data || !t ? <Loading /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Trend level" value={<Badge tone={t.risk_level === "high" ? "red" : t.risk_level === "elevated" ? "amber" : "green"} className="text-base">{t.risk_level}</Badge>} hint="Rule: slope and change vs baseline" />
            <Stat label="Slope" value={`${t.slope_per_day > 0 ? "+" : ""}${t.slope_per_day.toFixed(2)}`} hint="Change in daily count per day" tone="slate" />
            <Stat label="Last 7-day mean" value={t.recent_7d_mean.toFixed(1)} hint={`Baseline ${t.baseline_mean.toFixed(1)} per day`} />
            <Stat label="vs baseline" value={`${t.pct_change_vs_baseline > 0 ? "+" : ""}${t.pct_change_vs_baseline}%`} tone={t.pct_change_vs_baseline > 10 ? "amber" : "green"} />
          </div>
          <Card className="mt-6" title={metric === "anomalies" ? "Anomaly alerts per day (excluding false positives)" : "Incidents reported per day"} subtitle={f.data.method}>
            <TrendChart data={f.data} height={380} />
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Daily count</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-indigo-600" />7-day average</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-cyan-600" />Projected trend</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-300/50" />95% band (residual-based)</span>
            </div>
          </Card>
          <Card className="mt-6" title="Projection (next 14 days)">
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {f.data.forecast.map((p) => (
                <div key={p.date} className="rounded-lg bg-slate-50 p-2">
                  <p className="text-slate-500">{new Date(p.date + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
                  <p className="text-base font-semibold tabular-nums">{p.predicted.toFixed(1)}</p>
                  <p className="text-[10px] text-slate-400">{p.lower.toFixed(0)}–{p.upper.toFixed(0)}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
