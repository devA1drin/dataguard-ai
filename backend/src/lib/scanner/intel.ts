import { clip, Finding } from "./types";

/**
 * Outside information about a domain / URL. Every call has a short timeout and fails "open" with an
 * info finding: a missing answer is reported as "unknown", never as "safe" or "dangerous".
 * All hosts below are fixed, trusted public services (not user-controlled), so the global fetch is used.
 */
async function getJson(url: string, init: RequestInit = {}, ms = 6000): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": "DataGuardAI-WebsiteScanner/1.0", Accept: "application/json, application/rdap+json", ...(init.headers ?? {}) } });
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/** Domain age from RDAP (rdap.org forwards to the right registry). */
export async function domainAge(registrable: string | null): Promise<{ finding: Finding; created: string | null; ageDays: number | null; registrar: string | null }> {
  const unknown = (why: string) => ({ created: null, ageDays: null, registrar: null, finding: { id: "domain_age_unknown", category: "domain" as const, severity: "info" as const,
    title: "Domain age unknown", explanation: `Could not look up when this domain was registered (${why}). Some country domains (e.g. .ph) do not publish this data. This does not make the site safe or unsafe.` } });
  if (!registrable) return unknown("no registrable domain - an IP address or unusual host");
  try {
    const { status, json } = await getJson(`https://rdap.org/domain/${encodeURIComponent(registrable)}`);
    if (status !== 200 || typeof json !== "object") return unknown(status === 404 ? "the registry has no RDAP record" : `RDAP answered ${status}`);
    const ev = (json.events ?? []).find((e: any) => /registration/i.test(e.eventAction ?? ""));
    const registrar = (json.entities ?? []).find((e: any) => (e.roles ?? []).includes("registrar"))?.vcardArray?.[1]?.find((v: any) => v[0] === "fn")?.[3] ?? null;
    if (!ev?.eventDate) return unknown("the record has no registration date");
    const created = new Date(ev.eventDate);
    const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);
    const when = created.toISOString().slice(0, 10);
    const ev2 = `registered ${when}${registrar ? ` via ${clip(String(registrar), 60)}` : ""}`;
    if (ageDays < 30) return { created: when, ageDays, registrar, finding: { id: "domain_new", category: "domain", severity: "high", title: `Brand-new domain (${ageDays} day${ageDays === 1 ? "" : "s"} old)`,
      explanation: "This domain was registered less than 30 days ago. Most phishing sites are used for only a few days, so a very new domain is a strong red flag - especially if it asks for logins or payments.", evidence: ev2 } };
    if (ageDays < 180) return { created: when, ageDays, registrar, finding: { id: "domain_young", category: "domain", severity: "low", title: `Young domain (${ageDays} days old)`,
      explanation: "The domain is less than 6 months old. That alone is not bad, but well-known companies usually have much older domains.", evidence: ev2 } };
    return { created: when, ageDays, registrar, finding: { id: "domain_established", category: "domain", severity: "info", positive: true, title: `Established domain (${Math.floor(ageDays / 365)} years old)`,
      explanation: "The domain has existed for a long time, which is typical of legitimate organisations.", evidence: ev2 } };
  } catch (e) {
    return unknown((e as Error).name === "AbortError" ? "the lookup timed out" : "the lookup failed");
  }
}

/** OpenPhish community feed: free, no key, ~300 active phishing URLs, refreshed every few hours. Cached 30 min. */
let openPhish: { at: number; urls: Set<string>; hosts: Set<string> } | null = null;
const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
export async function openPhishCheck(urls: string[]): Promise<Finding> {
  try {
    if (!openPhish || Date.now() - openPhish.at > 30 * 60_000) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch("https://openphish.com/feed.txt", { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "DataGuardAI-WebsiteScanner/1.0" } });
        if (!r.ok) throw new Error(String(r.status));
        const lines = (await r.text()).split(/\r?\n/).map(norm).filter((l) => /^https?:\/\//.test(l));
        openPhish = { at: Date.now(), urls: new Set(lines), hosts: new Set(lines.map((l) => { try { return new URL(l).hostname; } catch { return ""; } }).filter(Boolean)) };
      } finally { clearTimeout(t); }
    }
    const hit = urls.find((u) => openPhish!.urls.has(norm(u)));
    const hostHit = urls.map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } }).find((h) => h && openPhish!.hosts.has(h));
    if (hit) return { id: "openphish_url", category: "threat_feed", severity: "critical", title: "Listed on the OpenPhish phishing feed",
      explanation: "This exact address is on OpenPhish's public list of active phishing pages. Do not enter any information.", evidence: clip(hit, 120) };
    if (hostHit) return { id: "openphish_host", category: "threat_feed", severity: "high", title: "Site hosts pages listed on OpenPhish",
      explanation: "Another page on this same host is on OpenPhish's list of active phishing pages.", evidence: hostHit };
    return { id: "openphish_clean", category: "threat_feed", severity: "info", positive: true, title: "Not on the OpenPhish feed",
      explanation: `Not found among the ${openPhish!.urls.size} currently listed phishing URLs. Feeds only know about reported sites, so this is not a guarantee.` };
  } catch {
    return { id: "openphish_unavailable", category: "threat_feed", severity: "info", title: "OpenPhish feed unavailable", explanation: "The free OpenPhish feed could not be downloaded right now, so this check was skipped." };
  }
}

/** URLhaus (abuse.ch). Since 2025 abuse.ch requires a FREE Auth-Key (https://auth.abuse.ch/) - set URLHAUS_AUTH_KEY. */
export async function urlhausCheck(url: string, host: string): Promise<Finding> {
  const key = process.env.URLHAUS_AUTH_KEY;
  if (!key) return { id: "urlhaus_skipped", category: "threat_feed", severity: "info", title: "URLhaus check skipped",
    explanation: "URLhaus (abuse.ch malware-URL database) now requires a free Auth-Key. Set URLHAUS_AUTH_KEY to enable this check." };
  try {
    const post = (path: string, body: string) => getJson(`https://urlhaus-api.abuse.ch/v1/${path}/`, { method: "POST", body, headers: { "Auth-Key": key, "Content-Type": "application/x-www-form-urlencoded" } });
    const u = await post("url", `url=${encodeURIComponent(url)}`);
    if (u.json?.query_status === "ok") return { id: "urlhaus_url", category: "threat_feed", severity: "critical", title: "Listed on URLhaus (malware distribution)",
      explanation: `abuse.ch URLhaus lists this exact URL as distributing malware (status: ${u.json.url_status ?? "?"}, threat: ${u.json.threat ?? "?"}).`, evidence: clip(String(u.json.urlhaus_reference ?? url), 120) };
    const h = await post("host", `host=${encodeURIComponent(host)}`);
    if (h.json?.query_status === "ok" && Number(h.json.url_count) > 0) {
      const online = (h.json.urls ?? []).filter((x: any) => x.url_status === "online").length;
      return { id: "urlhaus_host", category: "threat_feed", severity: online ? "high" : "medium", title: "Host listed on URLhaus",
        explanation: `URLhaus has ${h.json.url_count} malware URL(s) on this host (${online} still online).`, evidence: host };
    }
    if (u.status === 401 || h.status === 401) throw new Error("unauthorized");
    return { id: "urlhaus_clean", category: "threat_feed", severity: "info", positive: true, title: "Not on URLhaus", explanation: "Neither the URL nor the host is in the URLhaus malware database." };
  } catch {
    return { id: "urlhaus_unavailable", category: "threat_feed", severity: "info", title: "URLhaus unavailable", explanation: "The URLhaus lookup failed or timed out, so it was skipped." };
  }
}

/** Google Safe Browsing v4 - only when GSB_API_KEY is set (free key from Google Cloud). */
export async function safeBrowsingCheck(urls: string[]): Promise<Finding | null> {
  const key = process.env.GSB_API_KEY;
  if (!key) return null;
  try {
    const body = { client: { clientId: "dataguard-ai", clientVersion: "1.0" }, threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"], platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"], threatEntries: [...new Set(urls)].map((url) => ({ url })) } };
    const r = await getJson(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    if (r.status !== 200) throw new Error(String(r.status));
    const m = r.json?.matches ?? [];
    if (m.length) return { id: "gsb_match", category: "threat_feed", severity: "critical", title: "Flagged by Google Safe Browsing",
      explanation: `Google Safe Browsing lists this site as ${[...new Set(m.map((x: any) => x.threatType))].join(", ").toLowerCase().replace(/_/g, " ")}.` };
    return { id: "gsb_clean", category: "threat_feed", severity: "info", positive: true, title: "Not flagged by Google Safe Browsing", explanation: "Google Safe Browsing has no warning for this address." };
  } catch {
    return { id: "gsb_unavailable", category: "threat_feed", severity: "info", title: "Google Safe Browsing unavailable", explanation: "The Safe Browsing lookup failed, so it was skipped." };
  }
}
