import { ml } from "../ml";
import { analyzeHtml, PageFacts } from "./content";
import { domainParts, sharedHost, urlHeuristics } from "./heuristics";
import { domainAge, openPhishCheck, safeBrowsingCheck, urlhausCheck } from "./intel";
import { BlockedError, checkUrlShape, FetchResult, LookupError, MAX_REDIRECTS, resolvePublic, safeFetch, TlsInfo } from "./ssrf";
import { clip, Finding, SEVERITY_POINTS } from "./types";

export type Verdict = "Safe" | "Suspicious" | "Dangerous";
export interface ScanResult {
  url: string; final_url: string | null; score: number; verdict: Verdict; findings: Finding[];
  details: {
    reachable: boolean; status: number | null; ip: string | null; duration_ms: number; truncated: boolean;
    redirects: { url: string; status: number; ip: string }[];
    tls: TlsInfo | null; headers: Record<string, string | null>; page: PageFacts | null;
    domain: { registrable: string | null; created: string | null; age_days: number | null; registrar: string | null };
    ml: { probability: number; label: string } | null;
  };
}

/** Normalise what the user typed: trim, add https:// if no scheme. */
export function normalizeInput(raw: string): string {
  const s = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/]+:\d+(\/|$)/.test(s) ? s : `https://${s}`;
}

const HEADER_CHECKS: { key: string; name: string; why: string; good: (v: string) => boolean }[] = [
  { key: "strict-transport-security", name: "HSTS (Strict-Transport-Security)", why: "tells browsers to always use HTTPS, which stops downgrade attacks on public Wi-Fi", good: (v) => /max-age=\d{6,}/i.test(v) },
  { key: "content-security-policy", name: "Content-Security-Policy", why: "limits which scripts can run, reducing the damage of cross-site scripting (XSS)", good: () => true },
  { key: "x-frame-options", name: "X-Frame-Options", why: "stops other sites from showing this page inside a hidden frame (click-jacking)", good: (v) => /deny|sameorigin/i.test(v) },
  { key: "x-content-type-options", name: "X-Content-Type-Options", why: "stops browsers from guessing file types, which can turn uploads into scripts", good: (v) => /nosniff/i.test(v) },
  { key: "referrer-policy", name: "Referrer-Policy", why: "prevents full page addresses (which may contain private data) from leaking to other sites", good: (v) => !/unsafe-url/i.test(v) },
];

/** Category caps keep many small, common issues (e.g. missing headers) from outweighing real red flags. */
const CATEGORY_CAP: Partial<Record<Finding["category"], number>> = { headers: 10, url: 50, content: 50, redirects: 25 };

export function scoreFindings(findings: Finding[]): { score: number; verdict: Verdict } {
  const per: Record<string, number> = {};
  for (const f of findings) if (!f.positive) per[f.category] = (per[f.category] ?? 0) + SEVERITY_POINTS[f.severity];
  let score = Object.entries(per).reduce((s, [c, v]) => s + Math.min(v, CATEGORY_CAP[c as Finding["category"]] ?? 100), 0);
  if (findings.some((f) => f.category === "threat_feed" && f.severity === "critical")) score = Math.max(score, 90);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, verdict: score >= 60 ? "Dangerous" : score >= 30 ? "Suspicious" : "Safe" };
}

function tlsFindings(t: TlsInfo | null, finalUrl: string, inputUrl: string): Finding[] {
  const out: Finding[] = [];
  if (new URL(finalUrl).protocol === "http:") {
    out.push({ id: "no_https", category: "tls", severity: "medium", title: "No HTTPS (connection not encrypted)",
      explanation: "The page is served over plain HTTP. Anyone on the same network could read or change what you see and type. Never enter passwords or card details on such a page." });
    return out;
  }
  if (new URL(inputUrl).protocol === "http:") out.push({ id: "upgrades_https", category: "tls", severity: "info", positive: true, title: "Upgrades to HTTPS",
    explanation: "The plain-HTTP address automatically redirected to the encrypted HTTPS version." });
  if (!t) return out;
  const ev = [t.protocol, t.issuer && `issuer: ${t.issuer}`, t.daysLeft !== null && `expires in ${t.daysLeft} days`].filter(Boolean).join(" · ");
  if (!t.authorized) {
    const e = t.error ?? "unknown";
    const plain = /EXPIRED/.test(e) ? "the certificate has EXPIRED" : /SELF_SIGNED|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY/.test(e) ? "the certificate is self-signed or not issued by a trusted authority"
      : /ALTNAME|Hostname|IP:/.test(e) ? "the certificate belongs to a different domain" : /REVOKED/.test(e) ? "the certificate has been revoked" : "the certificate could not be verified";
    out.push({ id: "bad_cert", category: "tls", severity: "high", title: "Invalid HTTPS certificate",
      explanation: `Browsers will show a security warning because ${plain}. A broken certificate means you can't be sure who you are talking to - the connection could be intercepted.`, evidence: clip(`${e}${ev ? " · " + ev : ""}`, 200) });
  } else {
    out.push({ id: "valid_cert", category: "tls", severity: "info", positive: true, title: "Valid HTTPS certificate",
      explanation: "The connection is encrypted and the certificate is valid for this domain. Note: scammers can get free certificates too, so the padlock alone does not prove a site is honest.", evidence: ev });
    if (t.daysLeft !== null && t.daysLeft < 14) out.push({ id: "cert_expiring", category: "tls", severity: "low", title: `Certificate expires in ${t.daysLeft} days`,
      explanation: "The certificate is about to expire. Well-run sites renew automatically well before this." });
  }
  if (t.protocol && /TLSv1(\.1)?$|SSL/.test(t.protocol)) out.push({ id: "old_tls", category: "tls", severity: "medium", title: `Outdated encryption (${t.protocol})`,
    explanation: "TLS 1.0/1.1 are obsolete and have known weaknesses. Modern sites use TLS 1.2 or 1.3." });
  return out;
}

function redirectFindings(r: FetchResult, inputUrl: string): Finding[] {
  const out: Finding[] = [];
  const regs = [inputUrl, ...r.hops.slice(1).map((h) => h.url)].map((u) => domainParts(new URL(u).hostname).registrable ?? new URL(u).hostname);
  const distinct = [...new Set(regs)];
  if (r.tooManyRedirects) out.push({ id: "too_many_redirects", category: "redirects", severity: "medium", title: `More than ${MAX_REDIRECTS} redirects`,
    explanation: "The site kept bouncing the scanner to other addresses. Long redirect chains are used to hide the final destination.", evidence: clip(distinct.join(" → "), 200) });
  if (distinct.length > 1) out.push({ id: "cross_domain_redirect", category: "redirects", severity: distinct.length > 2 ? "medium" : "low",
    title: `Redirects to a different domain${distinct.length > 2 ? "s" : ""}`,
    explanation: `The address you entered sends visitors on to ${distinct.slice(1).join(", ")}. This is normal for link shorteners and some big sites, but phishing links also use it to hide where they really go. Check the final address below.`,
    evidence: clip(distinct.join(" → "), 200) });
  for (let i = 1; i < r.hops.length; i++) if (r.hops[i - 1].url.startsWith("https:") && r.hops[i].url.startsWith("http:")) {
    out.push({ id: "https_downgrade", category: "redirects", severity: "medium", title: "Redirect drops HTTPS",
      explanation: "An encrypted address redirected to an unencrypted one. That exposes your data on the way.", evidence: clip(r.hops[i].url, 120) }); break;
  }
  return out;
}

/**
 * Run every check on one URL. Throws BlockedError for SSRF-blocked targets (nothing is fetched).
 * Other failures (DNS, timeouts, TLS handshake errors) still produce a result with what could be checked.
 */
export async function scanWebsite(input: string): Promise<ScanResult> {
  const started = Date.now();
  const url = checkUrlShape(normalizeInput(input)).toString();
  const host = new URL(url).hostname;
  // SSRF pre-check before ANY outside lookup, so blocked targets never touch the network
  let ipLookupError: string | null = null;
  try { await resolvePublic(host); } catch (e) { if (e instanceof BlockedError) throw e; ipLookupError = (e as Error).message; }

  const findings: Finding[] = urlHeuristics(url);
  const registrable = domainParts(host).registrable;
  const mlP = ml<{ probability: number; label: string }>("/phishing/analyze", { kind: "url", text: url }, 15000).catch(() => null);
  const ageP = domainAge(registrable);

  let fetched: FetchResult | null = null; let fetchError: string | null = ipLookupError;
  if (!ipLookupError) {
    try { fetched = await safeFetch(url); } catch (e) {
      if (e instanceof BlockedError) throw e;
      fetchError = e instanceof LookupError ? e.message : `Could not load the site: ${clip((e as Error).message, 160)}`;
    }
  }
  const finalUrl = fetched?.finalUrl ?? null;
  const checkUrls = [url, ...(fetched?.hops.map((h) => h.url) ?? [])];
  const [mlRes, age, op, uh, gsb] = await Promise.all([mlP, ageP, openPhishCheck(checkUrls), urlhausCheck(finalUrl ?? url, new URL(finalUrl ?? url).hostname), safeBrowsingCheck(checkUrls)]);

  if (mlRes) {
    const p = mlRes.probability, pct = Math.round(p * 100);
    findings.push({ id: "ml_phishing", category: "ml", severity: p >= 0.8 ? "high" : p >= 0.5 ? "medium" : p >= 0.3 ? "low" : "info", positive: p < 0.3,
      title: `Phishing model: ${pct}% phishing-like`,
      explanation: p >= 0.3
        ? "DataGuard's machine-learning model thinks this address LOOKS like the phishing links it was trained on. It reads only the text of the URL, and it was trained on synthetic examples, so treat it as one hint among the other checks."
        : "DataGuard's machine-learning model does not find the address text phishing-like. It reads only the URL text and was trained on synthetic examples.",
      evidence: `model label: ${mlRes.label}` });
  } else findings.push({ id: "ml_unavailable", category: "ml", severity: "info", title: "Phishing model unavailable", explanation: "The ML service did not answer, so the URL-text model was skipped." });

  const platform = sharedHost(host);
  if (platform && age.finding.positive) // the platform is old, the page on it may be minutes old
    findings.push({ ...age.finding, positive: false, id: "domain_platform_age", title: `${registrable} is old, but it is a shared platform`,
      explanation: `${registrable} has existed for years, but anyone can create a page on ${platform}, so this says nothing about the page you are checking.` });
  else findings.push(age.finding);
  let tls: TlsInfo | null = null; const headers: Record<string, string | null> = {}; let page: PageFacts | null = null;
  if (fetched) {
    if (finalUrl && domainParts(new URL(finalUrl).hostname).registrable !== registrable) {
      for (const f of urlHeuristics(finalUrl)) if (!findings.some((x) => x.id === f.id)) findings.push({ ...f, id: `final_${f.id}`, title: `Final page: ${f.title}` });
    }
    findings.push(...redirectFindings(fetched, url));
    tls = [...fetched.hops].reverse().find((h) => h.tls)?.tls ?? null;
    if (finalUrl?.startsWith("http:")) tls = null;
    findings.push(...tlsFindings(tls, finalUrl!, url));
    for (const h of HEADER_CHECKS) {
      const v = fetched.headers[h.key] ?? null; headers[h.key] = v ? clip(v, 300) : null;
      if (h.key === "strict-transport-security" && finalUrl?.startsWith("http:")) continue; // HSTS only applies to HTTPS
      if (!v) findings.push({ id: `missing_${h.key}`, category: "headers", severity: "low", title: `Missing ${h.name}`, explanation: `This security header ${h.why}. Many sites still lack it, so it is a hygiene issue rather than proof of danger.` });
      else if (!h.good(v)) findings.push({ id: `weak_${h.key}`, category: "headers", severity: "low", title: `Weak ${h.name}`, explanation: `The header is present but its value is weak. It ${h.why}.`, evidence: clip(v, 120) });
    }
    if (fetched.status >= 400) findings.push({ id: "http_error", category: "content", severity: "info", title: `The site answered with HTTP ${fetched.status}`, explanation: "The page returned an error status, so the content checks may be incomplete." });
    if (/html|xml/i.test(fetched.contentType) || /^\s*</.test(fetched.body)) {
      const a = analyzeHtml(fetched.body, finalUrl!);
      findings.push(...a.findings); page = a.facts;
    } else if (fetched.body) findings.push({ id: "not_html", category: "content", severity: fetched.contentType.match(/octet-stream|x-msdownload|x-dosexec|java-archive|zip|vnd\.android/i) ? "medium" : "info",
      title: `Not a web page (${clip(fetched.contentType || "unknown type", 60)})`, explanation: "The address returns a file instead of a page. Unexpected downloads (especially .exe, .apk, .zip) from links are a common way to spread malware." });
  } else {
    findings.push({ id: "unreachable", category: "content", severity: "info", title: "Site could not be loaded", explanation: `${fetchError ?? "Unknown error"}. Only the address, domain and threat-feed checks were run.` });
  }
  findings.push(op, uh); if (gsb) findings.push(gsb);

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  findings.sort((a, b) => Number(!!a.positive) - Number(!!b.positive) || order[a.severity] - order[b.severity]);
  const { score, verdict } = scoreFindings(findings);
  return {
    url, final_url: finalUrl, score, verdict, findings,
    details: {
      reachable: !!fetched, status: fetched?.status ?? null, ip: fetched?.hops.at(-1)?.ip ?? null, duration_ms: Date.now() - started, truncated: fetched?.truncated ?? false,
      redirects: (fetched?.hops ?? []).map((h) => ({ url: clip(h.url, 300), status: h.status, ip: h.ip })),
      tls, headers, page, domain: { registrable, created: age.created, age_days: age.ageDays, registrar: age.registrar ? clip(String(age.registrar), 80) : null },
      ml: mlRes ? { probability: mlRes.probability, label: mlRes.label } : null,
    },
  };
}
