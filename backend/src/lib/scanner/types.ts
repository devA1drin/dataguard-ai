export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Category = "ml" | "url" | "domain" | "tls" | "redirects" | "headers" | "content" | "threat_feed";
export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** plain-English explanation for non-experts */
  explanation: string;
  /** short, text-only evidence (never HTML that is rendered) */
  evidence?: string;
  /** true for a GOOD sign (shown in green, adds no risk) */
  positive?: boolean;
}
export const SEVERITY_POINTS: Record<Severity, number> = { info: 0, low: 4, medium: 12, high: 25, critical: 45 };
export const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
