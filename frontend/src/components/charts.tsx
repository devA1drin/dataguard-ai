"use client";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, ReferenceLine } from "recharts";
import type { Forecast, ShapContribution } from "@/lib/types";
import { humanize } from "@/lib/format";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" });

/** History (bars + 7-day rolling mean) followed by projected trend with a confidence band. */
export function TrendChart({ data, height = 300 }: { data: Forecast; height?: number }) {
  const rows = [
    ...data.history.map((h) => ({ date: h.date, count: h.count, rolling: h.rolling_7d })),
    ...data.forecast.map((f) => ({ date: f.date, predicted: f.predicted, band: [f.lower, f.upper] as [number, number] })),
  ];
  const lastHist = data.history[data.history.length - 1]?.date;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 11, fill: "#64748b" }} minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
        <Tooltip labelFormatter={(d) => short(String(d))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Area dataKey="band" stroke="none" fill="#a5b4fc" fillOpacity={0.3} name="95% band" isAnimationActive={false} />
        <Bar dataKey="count" fill="#cbd5e1" name="Daily count" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Line dataKey="rolling" stroke="#4f46e5" strokeWidth={2} dot={false} name="7-day average" isAnimationActive={false} />
        <Line dataKey="predicted" stroke="#0891b2" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Projected trend" isAnimationActive={false} />
        {lastHist && <ReferenceLine x={lastHist} stroke="#94a3b8" strokeDasharray="2 2" label={{ value: "today", fontSize: 10, fill: "#64748b", position: "insideTopRight" }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CategoryBars({ data, height = 260 }: { data: { category: string; n: number }[]; height?: number }) {
  const colors = ["#4f46e5", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#64748b"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data.map((d) => ({ ...d, label: humanize(d.category) }))} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: "#334155" }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="n" name="Incidents" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal SHAP bar chart: red pushes toward "anomalous", blue toward "normal". */
export function ShapChart({ contributions }: { contributions: ShapContribution[] }) {
  const rows = contributions.map((c) => ({ name: `${c.label} = ${Number.isInteger(c.value) ? c.value : c.value.toFixed(2)}`, shap: c.shap }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis type="category" dataKey="name" width={210} tick={{ fontSize: 11, fill: "#334155" }} />
        <ReferenceLine x={0} stroke="#94a3b8" />
        <Tooltip formatter={(v) => Number(v).toFixed(3)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="shap" name="SHAP contribution" radius={3} isAnimationActive={false}>
          {rows.map((r, i) => <Cell key={i} fill={r.shap >= 0 ? "#e11d48" : "#0284c7"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
