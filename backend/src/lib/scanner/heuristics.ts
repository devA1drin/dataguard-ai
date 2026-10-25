import { domainToUnicode } from "url";
import { parse as parseDomain } from "tldts";
import { clip, Finding } from "./types";

/**
 * URL / domain heuristics. Pure functions (no network) so they are easy to unit-test.
 * Every finding explains in plain words WHY it matters.
 */

/** Well-known brands that phishers imitate, with the domains they really use. `anyTld` = brand.<any suffix> is official. */
export const BRANDS: { name: string; label: string; official: string[]; anyTld?: boolean }[] = [
  { name: "GCash", label: "gcash", official: ["gcash.com", "gcash.ph"] },
  { name: "BDO", label: "bdo", official: ["bdo.com.ph", "bdo.com"] },
  { name: "BPI", label: "bpi", official: ["bpi.com.ph", "bpiexpressonline.com", "bpi.com"] },
  { name: "Maya", label: "maya", official: ["maya.ph", "paymaya.com"] },
  { name: "Metrobank", label: "metrobank", official: ["metrobank.com.ph"] },
  { name: "Landbank", label: "landbank", official: ["landbank.com"] },
  { name: "UnionBank", label: "unionbank", official: ["unionbankph.com"] },
  { name: "Security Bank", label: "securitybank", official: ["securitybank.com"] },
  { name: "Lazada", label: "lazada", official: [], anyTld: true },
  { name: "Shopee", label: "shopee", official: [], anyTld: true },
  { name: "PayPal", label: "paypal", official: ["paypal.me", "paypalobjects.com"], anyTld: true },
  { name: "Facebook", label: "facebook", official: ["fb.com", "fb.me", "fbcdn.net", "meta.com"], anyTld: true },
  { name: "Instagram", label: "instagram", official: [], anyTld: true },
  { name: "Google", label: "google", official: ["gstatic.com", "googleapis.com", "youtube.com", "gmail.com", "googleusercontent.com", "g.co"], anyTld: true },
  { name: "Microsoft", label: "microsoft", official: ["live.com", "office.com", "microsoftonline.com", "outlook.com", "office365.com", "bing.com", "msn.com"], anyTld: true },
  { name: "Apple", label: "apple", official: ["icloud.com"], anyTld: true },
  { name: "Netflix", label: "netflix", official: [], anyTld: true },
  { name: "Amazon", label: "amazon", official: ["amazonaws.com", "a2z.com"], anyTld: true },
];

export const SUSPICIOUS_TLDS = new Set(["xyz", "top", "click", "online", "site", "live", "shop", "icu", "buzz", "zip", "mov", "tk", "ml", "ga", "cf",
  "gq", "rest", "cam", "country", "kim", "work", "sbs", "cfd", "monster", "quest", "bond", "cyou", "lol", "support", "help", "loan", "win", "vip"]);
export const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "rb.gy", "cutt.ly", "is.gd", "t.co", "goo.gl", "ow.ly", "buff.ly", "shorturl.at",
  "tiny.cc", "s.id", "v.gd", "t.ly", "rebrand.ly", "bl.ink", "short.io", "lnkd.in", "qrco.de"]);
const BAIT = ["login", "log-in", "signin", "sign-in", "verify", "verification", "secure", "update", "account", "confirm", "wallet", "unlock",
  "billing", "reward", "claim", "password", "otp", "suspend", "kyc"];

/** Map common look-alike characters (Cyrillic/Greek homoglyphs and digit swaps) to Latin letters. */
const CONFUSABLE: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ɡ": "g", "ӏ": "l",
  "α": "a", "ο": "o", "ρ": "p", "ν": "v", "τ": "t", "ι": "i", "κ": "k", "ε": "e", "ɑ": "a", "ı": "i", "ⅼ": "l",
};
const DIGITS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "$": "s" };
export const skeleton = (s: string, digits = false) =>
  [...s.toLowerCase()].map((c) => CONFUSABLE[c] ?? (digits ? DIGITS[c] ?? c : c)).join("").replace(/rn/g, "m").replace(/vv/g, "w");

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export interface DomainParts { host: string; unicodeHost: string; registrable: string | null; sld: string; tld: string; subdomain: string; isIp: boolean }
export function domainParts(hostname: string): DomainParts {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const p = parseDomain(host, { allowPrivateDomains: false });
  const unicodeHost = host.includes("xn--") ? domainToUnicode(host) || host : host;
  return { host, unicodeHost, registrable: p.domain ?? null, sld: p.domainWithoutSuffix ?? "", tld: p.publicSuffix ?? "", subdomain: p.subdomain ?? "", isIp: Boolean(p.isIp) };
}

export function isOfficial(brand: (typeof BRANDS)[number], registrable: string | null): boolean {
  if (!registrable) return false;
  if (brand.official.includes(registrable)) return true;
  return Boolean(brand.anyTld && parseDomain(registrable).domainWithoutSuffix === brand.label);
}

/** Which brand (if any) does this domain imitate without being the real one? */
export function brandLookalike(hostname: string): { brand: string; how: string; severity: "medium" | "high" } | null {
  const d = domainParts(hostname);
  if (d.isIp) return null;
  for (const b of BRANDS) if (isOfficial(b, d.registrable)) return null; // it IS an official domain of some brand
  const sldTokens = d.sld.split(/[-.]/).filter(Boolean);
  const subTokens = d.subdomain.split(/[-.]/).filter(Boolean);
  const has = (tokens: string[], whole: string, label: string) =>
    label.length <= 4 ? tokens.some((t) => t === label || t.replace(/\d+/g, "") === label) : whole.includes(label);
  for (const b of BRANDS) {
    if (has(sldTokens, d.sld, b.label)) return { brand: b.name, how: `the domain name contains "${b.label}" but ${d.registrable} is not an official ${b.name} domain`, severity: "high" };
    if (has(subTokens, d.subdomain, b.label)) return { brand: b.name, how: `"${b.label}" appears only in the sub-domain part; the real owner of the address is ${d.registrable}`, severity: "high" };
  }
  // look-alike spelling (homoglyphs, digit swaps, one or two letters off)
  const skel = skeleton(domainParts(d.unicodeHost).sld || d.unicodeHost.split(".")[0], true);
  for (const b of BRANDS) {
    if (b.label.length < 4) continue; // too short: too many false positives
    for (const tok of [skel, ...skel.split("-")]) {
      if (tok === b.label) return { brand: b.name, how: `"${d.sld}" is spelled to look like "${b.label}" (look-alike characters)`, severity: "high" };
      if (b.label.length < 6) continue; // fuzzy matching only for longer names (avoids apply.com ~ apple)
      const dist = levenshtein(tok, b.label);
      if (tok.length >= 5 && dist > 0 && dist <= (b.label.length >= 8 ? 2 : 1))
        return { brand: b.name, how: `"${d.sld}" is only ${dist} letter${dist > 1 ? "s" : ""} away from "${b.label}"`, severity: "medium" };
    }
  }
  return null;
}

/** All URL-string heuristics (no network). */
/** Platforms where anyone can publish a page under the platform's (old, reputable) domain. */
export function sharedHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  const p = parseDomain(host, { allowPrivateDomains: true });
  const PLATFORM = /(^|\.)(blogspot\.com|backblazeb2\.com|freemyip\.com|duckdns\.org|ngrok(-free)?\.(app|io|dev)|weebly\.com|wixsite\.com|webflow\.io|godaddysites\.com|000webhostapp\.com|firebaseapp\.com|web\.app|glitch\.me|repl\.co|replit\.app|herokuapp\.com|vercel\.app|netlify\.app|github\.io|pages\.dev|workers\.dev|cleverapps\.io|r2\.dev|storage\.googleapis\.com|blob\.core\.windows\.net|s3[.-][a-z0-9.-]*amazonaws\.com|sites\.google\.com|forms\.gle|docs\.google\.com|ipfs\.[a-z.]+|trycloudflare\.com)$/;
  const m = host.match(PLATFORM);
  if (m) return m[2];
  if (p.isPrivate && p.publicSuffix && p.subdomain !== "www") return p.publicSuffix;
  return null;
}

export function urlHeuristics(raw: string): Finding[] {
  const out: Finding[] = [];
  let u: URL;
  try { u = new URL(raw); } catch { return [{ id: "url_invalid", category: "url", severity: "high", title: "Not a valid URL", explanation: "The address could not be read as a web address." }]; }
  const d = domainParts(u.hostname);

  const shared = d.isIp ? null : sharedHost(d.host);
  if (shared) out.push({ id: "shared_hosting", category: "url", severity: "low", title: `Hosted on a shared/free platform (${shared})`,
    explanation: `Anyone can publish a page on ${shared}, so the platform's good reputation says nothing about who made this page. Phishing kits are often hosted on free platforms like this.`, evidence: d.host });

  if (d.isIp) out.push({ id: "ip_host", category: "url", severity: "high", title: "Uses a bare IP address instead of a name",
    explanation: "Real companies almost always use a domain name (like bdo.com.ph). Links that point straight to an IP address are a common phishing and malware trick.", evidence: d.host });

  if (u.username || u.password || /@/.test(raw.split("?")[0].replace(/^https?:\/\//i, "").split("/")[0]))
    out.push({ id: "at_sign", category: "url", severity: "high", title: "Contains '@' in the address",
      explanation: "Browsers ignore everything before an '@' in the host part. Attackers use this to make a link look like it goes to a trusted site (e.g. https://paypal.com@evil.example) when it really goes somewhere else.", evidence: clip(raw, 120) });

  if (d.host.includes("xn--")) {
    out.push({ id: "punycode", category: "url", severity: "medium", title: "International (punycode) domain",
      explanation: "The domain uses special non-English characters, written as 'xn--…'. These can be used to make a fake address look identical to a real one (for example a Cyrillic 'а' instead of a Latin 'a').", evidence: `${d.host} → ${d.unicodeHost}` });
  } else if (/[^\x00-\x7f]/.test(u.hostname)) {
    out.push({ id: "unicode_host", category: "url", severity: "medium", title: "Non-English characters in the domain",
      explanation: "Look-alike letters from other alphabets can make a fake domain look real.", evidence: u.hostname });
  }

  const look = brandLookalike(u.hostname);
  if (look) out.push({ id: "brand_lookalike", category: "url", severity: look.severity, title: `Looks like ${look.brand}, but isn't`,
    explanation: `Possible impersonation: ${look.how}. Scammers register addresses that resemble well-known brands to trick people into entering passwords or OTPs.`, evidence: d.host });

  const subCount = d.subdomain ? d.subdomain.split(".").filter(Boolean).length : 0;
  if (subCount >= 4) out.push({ id: "many_subdomains", category: "url", severity: "medium", title: `Many sub-domains (${subCount})`,
    explanation: "Very long chains like secure.login.account.example.xyz are used to push the real domain out of view on phone screens.", evidence: d.host });

  const tldLast = d.tld.split(".").pop() ?? "";
  if (SUSPICIOUS_TLDS.has(tldLast)) out.push({ id: "suspicious_tld", category: "url", severity: "low", title: `Cheap / often-abused ending ".${tldLast}"`,
    explanation: `Domains ending in .${tldLast} are cheap and are often used for short-lived scam sites. Many legitimate sites use it too, so this is only a weak signal.`, evidence: d.host });

  if (SHORTENERS.has(d.host)) out.push({ id: "shortener", category: "url", severity: "medium", title: "Link shortener",
    explanation: "Short links hide where they really go. The scanner follows the redirects to find the real destination (see the redirect chain).", evidence: d.host });

  if (raw.length > 200) out.push({ id: "very_long", category: "url", severity: "medium", title: `Very long URL (${raw.length} characters)`,
    explanation: "Extremely long addresses can hide the real destination or carry tracking/attack data.", evidence: clip(raw, 100) });
  else if (raw.length > 100) out.push({ id: "long", category: "url", severity: "low", title: `Long URL (${raw.length} characters)`,
    explanation: "Long addresses are harder to read and check by eye.", evidence: clip(raw, 100) });

  const hy = (d.sld.match(/-/g) ?? []).length;
  if (hy >= 3) out.push({ id: "many_hyphens", category: "url", severity: "low", title: "Many hyphens in the domain",
    explanation: "Names like secure-login-verify-account are typical of throw-away phishing domains.", evidence: d.host });

  const lowPath = (u.hostname + u.pathname).toLowerCase();
  const bait = BAIT.filter((w) => lowPath.includes(w));
  if (bait.length >= 2 && !BRANDS.some((b) => isOfficial(b, d.registrable)))
    out.push({ id: "bait_words", category: "url", severity: "low", title: "Bait words in the address",
      explanation: "Words like 'verify', 'login', 'account' and 'secure' are used to create urgency or trust. On their own they are normal, but together with other signals they are a warning.", evidence: bait.slice(0, 5).join(", ") });

  if (u.port && !["80", "443"].includes(u.port)) out.push({ id: "odd_port", category: "url", severity: "low", title: `Non-standard port ${u.port}`,
    explanation: "Normal websites use the default ports. A custom port is unusual for a public site.", evidence: u.host });
  return out;
}
