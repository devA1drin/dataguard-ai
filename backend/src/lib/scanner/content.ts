import { HTMLElement, parse } from "node-html-parser";
import { BRANDS, domainParts, isOfficial } from "./heuristics";
import { clip, Finding } from "./types";

/**
 * Static page analysis. The HTML is only PARSED as text - scripts are never executed, nothing is rendered,
 * and no sub-resources (images, scripts, frames) are downloaded.
 */
export interface PageFacts { title: string | null; forms: number; passwordFields: number; scripts: number; iframes: number }

const sameSite = (a: string | null, b: string | null) => !!a && !!b && a === b;
const reg = (host: string) => domainParts(host).registrable ?? host;

export function analyzeHtml(html: string, pageUrl: string): { findings: Finding[]; facts: PageFacts } {
  const out: Finding[] = [];
  const page = new URL(pageUrl);
  const pageReg = reg(page.hostname);
  const root = parse(html, { lowerCaseTagName: true, comment: false, blockTextElements: { script: true, style: false, noscript: false, pre: false } });
  const title = (root.querySelector("title")?.text ?? "").replace(/\s+/g, " ").trim() || null;

  // --- forms: passwords, foreign action targets, card / OTP fields
  const forms = root.querySelectorAll("form");
  const inputs = root.querySelectorAll("input");
  const pw = inputs.filter((i) => (i.getAttribute("type") ?? "").toLowerCase() === "password");
  const attrs = (i: HTMLElement) => ["name", "id", "autocomplete", "placeholder", "aria-label"].map((a) => (i.getAttribute(a) ?? "").toLowerCase()).join(" ");
  const card = inputs.filter((i) => /cc-?(number|num|csc|exp)|card.?(number|no|num)|cardnumber|\bcvv\b|\bcvc\b|\bcvv2\b|security.?code|expiry|exp-?date/.test(attrs(i)));
  const otp = inputs.filter((i) => /one-time-code|\botp\b|\bmpin\b|\bpin\b|verification.?code|auth.?code|sms.?code/.test(attrs(i)));

  if (pw.length) {
    const plain = page.protocol === "http:";
    out.push({ id: "password_form", category: "content", severity: plain ? "high" : "low",
      title: plain ? "Password box on a page without HTTPS" : "Page asks for a password",
      explanation: plain
        ? "This page has a password field but is not encrypted. Anything typed can be read by others on the same network (e.g. public Wi-Fi)."
        : "This page contains a login/password form. That is normal for real login pages - just make sure the address is exactly the real site before typing your password.",
      evidence: `${pw.length} password field${pw.length > 1 ? "s" : ""}` });
  }
  const foreign: string[] = []; let insecureAction = false;
  for (const f of forms) {
    const action = (f.getAttribute("action") ?? "").trim();
    if (!action || action.startsWith("#") || /^javascript:/i.test(action)) continue;
    let t: URL; try { t = new URL(action, page); } catch { continue; }
    if (/^mailto:/i.test(action)) { foreign.push(`mailto:${clip(t.pathname, 60)}`); continue; }
    if (!/^https?:$/.test(t.protocol)) continue;
    if (!sameSite(reg(t.hostname), pageReg)) foreign.push(t.hostname);
    if (page.protocol === "https:" && t.protocol === "http:") insecureAction = true;
  }
  if (foreign.length) out.push({ id: "foreign_form", category: "content", severity: pw.length || card.length || otp.length ? "high" : "medium",
    title: "Form sends data to a different website",
    explanation: "What you type on this page is sent to another domain, not the one in the address bar. Phishing kits often collect passwords this way.",
    evidence: clip([...new Set(foreign)].slice(0, 3).join(", "), 160) });
  if (insecureAction) out.push({ id: "insecure_form", category: "content", severity: "medium", title: "Form submits over plain HTTP",
    explanation: "The page itself is encrypted, but the form sends its data unencrypted.", });
  if (card.length) out.push({ id: "card_fields", category: "content", severity: "medium", title: "Asks for credit/debit card details",
    explanation: "The page has fields for a card number, CVV or expiry date. Only enter card details on shops you trust and reached yourself, not via a link in a message.",
    evidence: `${card.length} card-related field${card.length > 1 ? "s" : ""}` });
  if (otp.length) out.push({ id: "otp_fields", category: "content", severity: "medium", title: "Asks for an OTP / PIN",
    explanation: "Banks and e-wallets never ask you to enter a one-time PIN on a page you opened from a link. Scammers use OTP fields to take over accounts.",
    evidence: `${otp.length} OTP/PIN field${otp.length > 1 ? "s" : ""}` });

  // --- hidden iframes
  const iframes = root.querySelectorAll("iframe");
  const hidden = iframes.filter((f) => {
    const w = (f.getAttribute("width") ?? "").trim(), h = (f.getAttribute("height") ?? "").trim();
    const st = (f.getAttribute("style") ?? "").toLowerCase().replace(/\s/g, "");
    return ["0", "1", "0px", "1px"].includes(w) || ["0", "1", "0px", "1px"].includes(h) || /display:none|visibility:hidden|width:0|height:0|opacity:0/.test(st)
      || f.hasAttribute("hidden");
  });
  const hiddenExternal = hidden.filter((f) => { try { return !sameSite(reg(new URL(f.getAttribute("src") ?? "", page).hostname), pageReg); } catch { return false; } });
  if (hiddenExternal.length) out.push({ id: "hidden_iframe", category: "content", severity: "medium", title: "Hidden frame loading another site",
    explanation: "An invisible frame loads content from another domain. This is sometimes used for tracking, but also for drive-by malware and click-jacking.",
    evidence: clip(hiddenExternal.map((f) => f.getAttribute("src") ?? "").slice(0, 2).join(", "), 160) });

  // --- obfuscated JavaScript (inline scripts only; nothing is executed)
  const scripts = root.querySelectorAll("script");
  const inline = scripts.map((s) => s.rawText).join("\n");
  const count = (re: RegExp) => (inline.match(re) ?? []).length;
  const signals = {
    eval: count(/\beval\s*\(/g), atob: count(/\batob\s*\(/g), unescape: count(/\bunescape\s*\(/g), fromCharCode: count(/fromCharCode\s*\(/g),
    docWriteDecode: count(/document\.write\s*\(\s*(unescape|atob|decodeURIComponent)/g), hex: count(/(\\x[0-9a-f]{2}){20,}/gi),
    blob: count(/["'][A-Za-z0-9+/=]{800,}["']/g), pct: count(/(%[0-9a-f]{2}){40,}/gi),
  };
  const heavy = signals.docWriteDecode * 3 + (signals.eval && (signals.atob || signals.unescape || signals.fromCharCode) ? 3 : 0)
    + Math.min(3, signals.hex) + Math.min(2, signals.blob) + Math.min(2, signals.pct) + (signals.fromCharCode > 5 ? 1 : 0);
  if (heavy >= 3) {
    const ev = Object.entries(signals).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join(", ");
    out.push({ id: "obfuscated_js", category: "content", severity: heavy >= 6 ? "high" : "medium", title: "Heavily obfuscated JavaScript",
      explanation: "The page contains scripts that hide their real code (eval/atob/unescape, long encoded strings). Legitimate sites rarely need this; malware and phishing kits use it to avoid detection. (The scanner never runs these scripts.)",
      evidence: ev });
  }

  // --- meta refresh to another domain
  const meta = root.querySelectorAll("meta").find((m) => (m.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh");
  const mUrl = /url\s*=\s*['"]?([^'";]+)/i.exec(meta?.getAttribute("content") ?? "")?.[1];
  if (mUrl) { try { const t = new URL(mUrl, page); if (!sameSite(reg(t.hostname), pageReg)) out.push({ id: "meta_refresh", category: "content", severity: "medium",
    title: "Page automatically forwards to another site", explanation: "A hidden 'refresh' tag sends visitors to another domain after loading. This is a common way to bounce victims to the real phishing page.", evidence: clip(t.hostname, 100) }); } catch { /* ignore */ } }

  // --- page claims to be a brand that does not own this domain
  const siteName = root.querySelectorAll("meta").find((m) => (m.getAttribute("property") ?? "").toLowerCase() === "og:site_name")?.getAttribute("content") ?? "";
  const claim = `${title ?? ""} ${siteName}`.toLowerCase();
  const isAnyOfficial = BRANDS.some((b) => isOfficial(b, pageReg));
  if (!isAnyOfficial) {
    const b = BRANDS.find((x) => new RegExp(`(^|[^a-z])${x.name.toLowerCase().replace(/ /g, "\\s?")}([^a-z]|$)`).test(claim));
    if (b) out.push({ id: "title_brand_mismatch", category: "content", severity: pw.length || otp.length || card.length ? "high" : "medium",
      title: `Page says "${b.name}" but the domain isn't ${b.name}'s`,
      explanation: `The page title presents itself as ${b.name}, yet it is hosted on ${pageReg}, which is not an official ${b.name} domain. This mismatch is a classic sign of a fake login page (it can also be a news article or review that mentions the brand).`,
      evidence: clip(title ?? siteName, 120) });
  }
  return { findings: out, facts: { title: title ? clip(title, 160) : null, forms: forms.length, passwordFields: pw.length, scripts: scripts.length, iframes: iframes.length } };
}
