export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—";
export const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" }) : "—";
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const humanize = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIt\b/g, "IT") : "—";

export const PURPOSE_INFO: Record<string, { label: string; desc: string }> = {
  marketing_email: { label: "Marketing emails", desc: "Newsletters, promotions and product announcements by email." },
  sms_promotions: { label: "SMS promotions", desc: "Promotional text messages about sales and vouchers." },
  personalized_recommendations: { label: "Personalized recommendations", desc: "Use of your order history to suggest products." },
  third_party_sharing: { label: "Sharing with partners", desc: "Sharing contact details with selected marketing partners." },
  analytics: { label: "Analytics", desc: "Aggregated analysis of how you use our store to improve services." },
};
