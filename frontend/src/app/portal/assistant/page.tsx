"use client";
import { BookOpen, Bot, Send, ShieldQuestion, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, PageHeader, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { DEMO_MODE } from "@/lib/config";
import type { AssistantAnswer } from "@/lib/types";

const SUGGESTED = [
  "How do I withdraw my consent for SMS promotions?",
  "How long do you keep my order records?",
  "Can I ask you to delete my account data?",
  "Do you sell my personal data to other companies?",
  "What happens if there is a data breach?",
];
type Msg = { role: "user"; text: string } | { role: "bot"; a: AssistantAnswer };

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { void end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setMsgs((m) => [...m, { role: "user", text: question }]); setQ(""); setBusy(true);
    try { const a = await api.ask(question); setMsgs((m) => [...m, { role: "bot", a }]); }
    catch (e) { setMsgs((m) => [...m, { role: "bot", a: { answer: `Sorry, the assistant is unavailable (${(e as Error).message}).`, covered: false, confidence: 0, citations: [], mode: "error", retrieval_backend: "" } }]); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Privacy assistant" description="Ask about how Acme Retail PH handles your data. Answers are quoted from the company's (sample) privacy policy documents with citations. If the policies don't cover your question, the assistant says so instead of guessing." />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="flex flex-col">
          <div className="min-h-[420px] space-y-5">
            {!msgs.length && (
              <div className="grid place-items-center py-16 text-center">
                <ShieldQuestion className="h-10 w-10 text-indigo-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">Ask a question about your privacy</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">Try one of the suggested questions on the right.</p>
              </div>
            )}
            {msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex justify-end gap-3">
                <p className="max-w-[75%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm text-white">{m.text}</p>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200"><User className="h-4 w-4 text-slate-600" /></span>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400"><Bot className="h-4 w-4 text-white" /></span>
                <div className="max-w-[85%] space-y-3">
                  <div className={cx("whitespace-pre-line rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed", m.a.covered ? "bg-slate-100 text-slate-800" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200")}>
                    {!m.a.covered && <p className="mb-1 text-xs font-semibold uppercase tracking-wide">Not covered by policy</p>}
                    {m.a.answer}
                  </div>
                  {m.a.citations.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Sources</p>
                      {m.a.citations.map((c, j) => (
                        <details key={j} className="group rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" open={j === 0}>
                          <summary className="flex cursor-pointer items-center gap-2 text-slate-700">
                            <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
                            <span className="flex-1 font-medium">[{j + 1}] {c.title.replace(/ \(SAMPLE \/ FICTIONAL\)/, "")} — {c.section}</span>
                            <Badge tone="indigo">match {(c.score * 100).toFixed(0)}%</Badge>
                          </summary>
                          <p className="mt-2 border-l-2 border-indigo-200 pl-3 text-slate-600">{c.passage}</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">{c.doc}</p>
                        </details>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400">mode: {m.a.mode} · retrieval: {m.a.retrieval_backend} · confidence {(m.a.confidence * 100).toFixed(0)}%{m.a.demo_matched_question && ` · demo: matched “${m.a.demo_matched_question}”`}</p>
                </div>
              </div>
            ))}
            {busy && <p className="pl-11 text-xs text-slate-400">Searching policy documents…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
            <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How can I get a copy of my data?" maxLength={500} />
            <Button disabled={busy || q.trim().length < 3}><Send className="h-4 w-4" />Ask</Button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="Suggested questions">
            <div className="flex flex-col gap-2">
              {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50">{s}</button>)}
            </div>
          </Card>
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">This assistant is not legal advice. Policy documents are fictional samples for the demo company. {DEMO_MODE && "In demo mode, answers were pre-computed by the real retrieval pipeline for a fixed set of questions."}</p>
        </div>
      </div>
    </>
  );
}
