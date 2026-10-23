"use client";
import { FlaskConical } from "lucide-react";
import { DEMO_MODE } from "@/lib/config";
import { demoGeneratedAt, resetDemo } from "@/lib/demo";

/** Visible notice whenever the app runs on bundled sample data. */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
      <FlaskConical className="h-3.5 w-3.5" />
      <span><strong>Demo mode, sample data.</strong> Synthetic data and pre-computed model outputs (exported {new Date(demoGeneratedAt).toLocaleDateString("en-PH")}). Changes stay in your browser only.</span>
      <button className="font-semibold underline underline-offset-2" onClick={() => { resetDemo(); window.location.reload(); }}>Reset</button>
    </div>
  );
}
