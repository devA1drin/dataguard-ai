"use client";
import { Info } from "lucide-react";
import { useState } from "react";
import { AttackBadge } from "@/components/security";
import { Badge, Card, ErrorBox, Loading, PageHeader, Stat, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize, pct } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

function BinaryMatrix({ cm }: { cm: { tn: number; fp: number; fn: number; tp: number } }) {
  const cells = [["True negative", cm.tn, "bg-emerald-50 text-emerald-800"], ["False positive", cm.fp, "bg-amber-50 text-amber-800"],
    ["False negative", cm.fn, "bg-rose-50 text-rose-800"], ["True positive", cm.tp, "bg-indigo-50 text-indigo-800"]] as const;
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-sm">
      <span /><span className="text-center text-xs text-slate-500">Predicted normal</span><span className="text-center text-xs text-slate-500">Predicted anomalous</span>
      <span className="self-center text-right text-xs text-slate-500">Actual normal</span>
      {cells.slice(0, 2).map(([l, v, c]) => <div key={l} className={cx("rounded-lg p-4 text-center", c)}><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="text-[11px]">{l}</p></div>)}
      <span className="self-center text-right text-xs text-slate-500">Actual anomalous</span>
      {cells.slice(2).map(([l, v, c]) => <div key={l} className={cx("rounded-lg p-4 text-center", c)}><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="text-[11px]">{l}</p></div>)}
    </div>
  );
}

function MultiMatrix({ labels, cm }: { labels: string[]; cm: number[][] }) {
  const max = Math.max(...cm.flat());
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead><tr><th className="p-1 text-left text-slate-400">actual ↓ / predicted →</th>{labels.map((l) => <th key={l} className="w-16 p-1 text-center font-medium text-slate-500" title={l}>{humanize(l).split(" ").map((w) => w.slice(0, 5)).join(" ")}</th>)}</tr></thead>
        <tbody>{cm.map((row, i) => (
          <tr key={i}><td className="whitespace-nowrap p-1 pr-3 text-slate-600">{humanize(labels[i])}</td>
            {row.map((v, j) => <td key={j} className="p-0.5"><div className={cx("grid h-10 place-items-center rounded tabular-nums", i === j ? "font-semibold text-white" : v ? "text-rose-800" : "text-slate-300")}
              style={{ background: i === j ? `rgba(79,70,229,${0.35 + 0.65 * (v / max)})` : v ? `rgba(244,63,94,${0.08 + 0.5 * (v / max)})` : "#f8fafc" }}>{v}</div></td>)}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export default function ModelsPage() {
  const m = useAsync(() => api.metrics());
  const [clf, setClf] = useState<string | null>(null);
  if (m.error) return <ErrorBox error={m.error} />;
  if (!m.data) return <Loading />;
  const a = m.data.anomaly_detection, ic = m.data.incident_classification;
  const sel = clf ?? ic.selected_model;
  const cm = ic.models[sel];

  return (
    <>
      <PageHeader title="Model performance" description="Evaluation results written by ml-service/training/run_all.py. These are measured on synthetic data with injected, labelled anomalies, so they show the pipeline works — not how it would perform on a real company's logs." />
      <div className="mb-6 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>{m.data.data_note} Generated {new Date(m.data.generated_at).toLocaleString("en-PH")}.</span></div>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Access-log anomaly detection <span className="font-normal text-slate-500">· {a.model}</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Precision" value={pct(a.precision)} hint="Flagged events that were real anomalies" />
        <Stat label="Recall" value={pct(a.recall)} hint="Injected anomalies that were flagged" />
        <Stat label="F1 score" value={pct(a.f1)} tone="green" />
        <Stat label="False-positive rate" value={pct(a.false_positive_rate, 2)} tone="amber" hint="Normal events wrongly flagged" />
        <Stat label="ROC-AUC" value={a.roc_auc.toFixed(3)} tone="slate" hint={`Avg precision ${a.average_precision.toFixed(3)}`} />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card title="Confusion matrix" subtitle={`${a.split} · ${a.n_test.toLocaleString()} test events, ${pct(a.test_anomaly_rate)} anomalous`}><BinaryMatrix cm={a.confusion_matrix} /></Card>
        <Card title="Recall by injected anomaly pattern" subtitle="Which kinds of suspicious behaviour the model catches">
          <div className="space-y-3">
            {Object.entries(a.recall_by_anomaly_type as Record<string, number>).map(([k, v]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-700">{humanize(k)}</span><span className="tabular-nums text-slate-500">{pct(v, 0)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={cx("h-full rounded-full", v >= 0.9 ? "bg-emerald-500" : v >= 0.75 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${v * 100}%` }} /></div>
              </div>
            ))}
            <p className="pt-2 text-[11px] text-slate-500">Role-mismatch events (normal volume for some roles) are the hardest: the model has no notion of “who is allowed to see what”.</p>
          </div>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-900">Incident report classification <span className="font-normal text-slate-500">· TF-IDF features, {ic.n_train} train / {ic.n_test} test, {pct(ic.label_noise_injected, 0)} label noise injected</span></h2>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(ic.models as Record<string, { accuracy: number; macro_precision: number; macro_recall: number; macro_f1: number; cv5_macro_f1_mean: number; cv5_macro_f1_std: number }>).map(([name, r]) => (
          <button key={name} onClick={() => setClf(name)} className={cx("rounded-xl border bg-white p-5 text-left shadow-sm transition", sel === name ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-slate-200 hover:border-slate-300")}>
            <div className="flex items-center justify-between"><p className="font-medium text-slate-900">{humanize(name)}</p>{name === ic.selected_model && <Badge tone="indigo">Selected for serving</Badge>}</div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[["Accuracy", r.accuracy], ["Macro P", r.macro_precision], ["Macro R", r.macro_recall], ["Macro F1", r.macro_f1]].map(([l, v]) => (
                <div key={l as string}><p className="text-lg font-semibold tabular-nums">{pct(v as number)}</p><p className="text-[11px] text-slate-500">{l}</p></div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">5-fold CV macro-F1: {pct(r.cv5_macro_f1_mean)} ± {pct(r.cv5_macro_f1_std)}</p>
          </button>
        ))}
      </div>
      <Card className="mt-4" title={`Confusion matrix — ${humanize(sel)}`} subtitle="Click a model above to switch"><MultiMatrix labels={cm.labels} cm={cm.confusion_matrix} /></Card>
      {m.data.phishing_detection && <PhishingMetrics p={m.data.phishing_detection} />}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PhishingMetrics({ p }: { p: any }) {
  return (
    <>
      <h2 className="mt-10 flex items-center gap-3 text-lg font-semibold text-slate-900">Phishing detection <AttackBadge id="T1566" /></h2>
      <p className="mt-1 max-w-4xl text-sm text-slate-600">Two logistic-regression models (one for URLs, one for email/SMS text). Held-out test-set results at threshold {p.threshold}.</p>
      <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200"><Info className="h-4 w-4 shrink-0" />{p.data_source}</div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(["url_model", "email_model"] as const).map((k) => { const r = p[k]; return (
          <Card key={k} title={k === "url_model" ? "URL model" : "Email / SMS model"} subtitle={`${r.algorithm} · ${r.n_train.toLocaleString()} train / ${r.n_test.toLocaleString()} test`}>
            <div className="mb-4 grid grid-cols-4 gap-2 text-center">
              {[["Precision", r.precision], ["Recall", r.recall], ["F1", r.f1], ["ROC-AUC", r.roc_auc]].map(([l, v]) => (
                <div key={l as string}><p className="text-lg font-semibold tabular-nums">{pct(v as number)}</p><p className="text-[11px] text-slate-500">{l}</p></div>))}
            </div>
            <BinaryMatrix cm={r.confusion_matrix} />
          </Card>); })}
      </div>
    </>
  );
}
