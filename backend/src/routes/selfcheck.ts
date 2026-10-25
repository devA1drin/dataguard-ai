import { Request, Router } from "express";
import tls from "tls";
import { config } from "../config";
import { audit } from "../lib/audit";
import { authenticate, csrfProtect, REVIEWERS, requireRole, secureCookies, SESSION_COOKIE, sessionCookieOptions } from "../lib/auth";

/**
 * Security self-check: grades the DEPLOYED site's HTTP security headers, cookie flags and TLS.
 * To avoid SSRF it only ever scans an allow-list: SELF_CHECK_URL (comma-separated) or this
 * deployment's own URL - never a URL supplied by the browser.
 */
const r = Router();

/** Public, harmless: sets a short-lived probe cookie with EXACTLY the session cookie's options. */
r.get("/cookie-probe", (_req, res) => {
  const name = SESSION_COOKIE.replace("dg_session", "dg_probe");
  res.cookie(name, "probe", sessionCookieOptions(60_000));
  res.json({ ok: true, cookie: name, secure: secureCookies });
});

function targets(req: Request): string[] {
  const list = config.selfCheckUrls.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https?:\/\//.test(s));
  if (list.length) return list;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) list.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (process.env.VERCEL_URL) list.push(`https://${process.env.VERCEL_URL}`);
  if (!list.length) list.push(`${req.protocol}://${req.get("host")}`);
  return [...new Set(list)];
}

type Status = "pass" | "warn" | "fail" | "info";
interface Check { key: string; label: string; status: Status; value: string; tip: string }

async function get(url: string, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "DataGuard-SelfCheck/1.0" } }); }
  finally { clearTimeout(t); }
}

function tlsInfo(host: string, port: number): Promise<{ protocol: string | null; validTo: string; authorized: boolean; error?: string }> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, timeout: 8000 }, () => {
      const cert = sock.getPeerCertificate();
      resolve({ protocol: sock.getProtocol(), validTo: cert.valid_to, authorized: sock.authorized, error: sock.authorizationError?.toString() });
      sock.end();
    });
    sock.on("error", (e) => resolve({ protocol: null, validTo: "", authorized: false, error: e.message }));
    sock.on("timeout", () => { sock.destroy(); resolve({ protocol: null, validTo: "", authorized: false, error: "timeout" }); });
  });
}

async function scan(base: string): Promise<{ checks: Check[]; score: number; grade: string }> {
  const u = new URL(base);
  const checks: Check[] = [];
  const add = (key: string, label: string, status: Status, value: string, tip: string) => checks.push({ key, label, status, value, tip });

  // TLS
  if (u.protocol === "https:") {
    const t = await tlsInfo(u.hostname, Number(u.port || 443));
    const days = t.validTo ? Math.floor((new Date(t.validTo).getTime() - Date.now()) / 86400000) : -1;
    const good = t.authorized && (t.protocol === "TLSv1.3" || t.protocol === "TLSv1.2");
    add("tls", "HTTPS with modern TLS", good ? "pass" : "fail", t.protocol ? `${t.protocol}, certificate valid ${days} more days` : `no TLS (${t.error})`,
      good ? "Good: traffic is encrypted with TLS 1.2+." : "Serve the site over HTTPS with TLS 1.2 or 1.3 and a valid certificate.");
    if (good && days < 14) add("cert", "Certificate expiry", "warn", `${days} days left`, "Renew the certificate soon (hosting providers usually auto-renew).");
    try {
      const h = await get(`http://${u.host}/`);
      const loc = h.headers.get("location") ?? "";
      const ok = [301, 302, 307, 308].includes(h.status) && loc.startsWith("https://");
      add("redirect", "HTTP redirects to HTTPS", ok ? "pass" : "fail", `${h.status} ${loc || ""}`.trim(),
        ok ? "Good: plain-HTTP visitors are sent to the encrypted site." : "Redirect every http:// request to https:// (301/308).");
    } catch (e) { add("redirect", "HTTP redirects to HTTPS", "warn", `could not test (${(e as Error).message})`, "Make sure port 80 redirects to HTTPS."); }
  } else {
    add("tls", "HTTPS with modern TLS", "fail", "site is served over plain HTTP",
      "Use HTTPS. On localhost this is expected; the hosted (Vercel) site uses TLS automatically.");
  }

  const page = await get(base + "/");
  const h = (n: string) => page.headers.get(n);
  const hsts = h("strict-transport-security");
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? "")?.[1] ?? 0);
  add("hsts", "Strict-Transport-Security (HSTS)", maxAge >= 15552000 ? "pass" : hsts ? "warn" : "fail", hsts ?? "missing",
    maxAge >= 15552000 ? "Good: browsers will refuse to load the site without HTTPS." : "Send 'Strict-Transport-Security: max-age=63072000; includeSubDomains'.");

  const csp = h("content-security-policy");
  const script = /script-src([^;]*)/.exec(csp ?? "")?.[1] ?? /default-src([^;]*)/.exec(csp ?? "")?.[1] ?? "";
  const strictScripts = csp && !/'unsafe-inline'/.test(script) || /'nonce-|'strict-dynamic'/.test(script);
  add("csp", "Content-Security-Policy", !csp ? "fail" : strictScripts && !/'unsafe-eval'/.test(script) ? "pass" : "warn",
    csp ? (csp.length > 140 ? csp.slice(0, 140) + "..." : csp) : "missing",
    !csp ? "Add a CSP so injected scripts can't run (start with default-src 'self')."
      : strictScripts ? "Good: scripts are restricted (nonce-based, no 'unsafe-inline')." : "Remove 'unsafe-inline'/'unsafe-eval' from script-src; use nonces.");

  const xfo = h("x-frame-options");
  const fa = /frame-ancestors\s+([^;]*)/.exec(csp ?? "")?.[1];
  add("frame", "Clickjacking protection", xfo || fa ? "pass" : "fail", [xfo && `X-Frame-Options: ${xfo}`, fa && `frame-ancestors ${fa}`].filter(Boolean).join(" · ") || "missing",
    xfo || fa ? "Good: other sites can't load this site in a hidden frame." : "Send 'X-Frame-Options: DENY' or CSP 'frame-ancestors 'none''.");
  const nos = h("x-content-type-options");
  add("nosniff", "X-Content-Type-Options", nos?.toLowerCase() === "nosniff" ? "pass" : "fail", nos ?? "missing",
    nos ? "Good: browsers won't guess file types." : "Send 'X-Content-Type-Options: nosniff'.");
  const rp = h("referrer-policy");
  add("referrer", "Referrer-Policy", rp && !/unsafe-url|no-referrer-when-downgrade/.test(rp) ? "pass" : rp ? "warn" : "fail", rp ?? "missing",
    rp ? "Good: full URLs aren't leaked to other sites." : "Send 'Referrer-Policy: strict-origin-when-cross-origin'.");
  const pp = h("permissions-policy");
  add("permissions", "Permissions-Policy", pp ? "pass" : "warn", pp ? (pp.length > 100 ? pp.slice(0, 100) + "..." : pp) : "missing",
    pp ? "Good: camera, microphone and location are switched off." : "Send 'Permissions-Policy: camera=(), microphone=(), geolocation=()'.");
  const coop = h("cross-origin-opener-policy");
  add("coop", "Cross-Origin-Opener-Policy", coop === "same-origin" ? "pass" : coop ? "warn" : "warn", coop ?? "missing",
    coop ? "Good: other windows can't script this one." : "Send 'Cross-Origin-Opener-Policy: same-origin'.");
  const xpb = h("x-powered-by");
  add("powered", "No technology banner (X-Powered-By)", xpb ? "warn" : "pass", xpb ?? "not sent",
    xpb ? "Remove X-Powered-By so attackers learn less about the stack." : "Good: the server doesn't advertise its framework.");

  // session cookie flags (via the probe endpoint, which uses the same options)
  try {
    const p = await get(base + "/api/security/cookie-probe");
    const sc = p.headers.get("set-cookie") ?? "";
    if (!sc) add("cookie", "Session cookie flags", "info", "probe endpoint not reachable on this URL", "Run the check against the URL that serves /api.");
    else {
      const flags = { httpOnly: /;\s*httponly/i.test(sc), secure: /;\s*secure/i.test(sc), sameSite: /samesite=(strict|lax)/i.exec(sc)?.[1] ?? "none", host: sc.startsWith("__Host-") };
      const allOk = flags.httpOnly && flags.secure && flags.sameSite !== "none";
      add("cookie", "Session cookie flags", allOk ? "pass" : flags.httpOnly ? "warn" : "fail",
        `HttpOnly=${flags.httpOnly} · Secure=${flags.secure} · SameSite=${flags.sameSite} · __Host- prefix=${flags.host}`,
        allOk ? "Good: JavaScript can't read the session cookie and it's only sent over HTTPS to this site."
          : "Set HttpOnly, Secure and SameSite on the session cookie (Secure needs HTTPS - expected to fail on plain-HTTP localhost).");
    }
    const api = await get(base + "/api/health");
    const apiCsp = api.headers.get("content-security-policy") ?? "";
    add("api", "API responses locked down", /default-src 'none'|default-src 'self'/.test(apiCsp) && api.headers.get("x-content-type-options") ? "pass" : "warn",
      apiCsp ? `CSP: ${apiCsp.slice(0, 80)}` : "no CSP on API", "API JSON should be served with nosniff and a 'default-src 'none'' CSP.");
  } catch (e) { add("cookie", "Session cookie flags", "info", `could not test (${(e as Error).message})`, "Run the check against the deployed URL."); }

  const pts = { pass: 1, warn: 0.5, fail: 0, info: -1 } as const;
  const graded = checks.filter((c) => c.status !== "info");
  const score = Math.round((100 * graded.reduce((s, c) => s + pts[c.status], 0)) / Math.max(1, graded.length));
  return { checks, score, grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F" };
}

r.use(authenticate, csrfProtect, requireRole(...REVIEWERS));
r.get("/self-check/targets", (req, res) => res.json({ targets: targets(req) }));
r.post("/self-check", async (req, res) => {
  const list = targets(req);
  const idx = Number(req.body?.target ?? 0);
  const base = list[Number.isInteger(idx) && idx >= 0 && idx < list.length ? idx : 0];
  try {
    const out = await scan(base);
    await audit({ actorId: req.user!.id, actorRole: req.user!.role, action: "security.self_check", entityType: "deployment", entityId: base, ip: req.ip,
      details: { grade: out.grade, score: out.score } });
    res.json({ target: base, scanned_at: new Date().toISOString(), ...out });
  } catch (e) {
    res.status(502).json({ error: `Could not reach ${base}: ${(e as Error).message}` });
  }
});

export default r;
