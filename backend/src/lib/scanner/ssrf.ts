import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import { TLSSocket } from "tls";
import zlib from "zlib";

/**
 * SSRF guard + safe fetcher for the Website Scanner.
 *
 * The scanner fetches URLs typed by users, so without care it could be abused to reach things that are
 * only reachable from the server: localhost services, the private network or the cloud metadata service
 * (169.254.169.254). Defences, applied on EVERY redirect hop:
 *  - only http: / https: URLs, only ports 80, 443, 8080, 8443, no credentials sent;
 *  - the host name is resolved here and EVERY returned address must be public (see isBlockedIp);
 *  - the TCP connection is pinned to the address we checked (custom `lookup`), so a DNS answer that
 *    changes between the check and the connect (DNS rebinding) can't sneak in a private address;
 *  - redirects are followed manually (max 5), timeout 8 s per request, body capped at 2 MB
 *    (also after decompression), GET only, a custom User-Agent, and the HTML is never executed.
 */
export const SCANNER_UA = "DataGuardAI-WebsiteScanner/1.0 (+security scan; static HTML only)";
export const MAX_BODY = 2 * 1024 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 5;
export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export class BlockedError extends Error {
  constructor(message: string) { super(message); this.name = "BlockedError"; }
}

const v4 = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
] as [string, number][]) v4.addSubnet(a, p, "ipv4");
const v6 = new net.BlockList();
for (const [a, p] of [
  ["::", 128], ["::1", 128], ["::", 96] /* IPv4-compatible (deprecated) */, ["100::", 64], ["2001::", 32] /* Teredo */,
  ["2001:db8::", 32], ["2002::", 16] /* 6to4 */, ["fc00::", 7] /* unique local, incl. AWS fd00:ec2::254 */,
  ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as [string, number][]) v6.addSubnet(a, p, "ipv6");

/** Extract an embedded IPv4 address from IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) IPv6 addresses. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const h = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (h) { const a = parseInt(h[1], 16), b = parseInt(h[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}

/** True when an address is loopback, private, link-local (incl. cloud metadata), reserved, multicast or documentation-only. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const kind = net.isIP(bare);
  if (kind === 4) return v4.check(bare, "ipv4");
  if (kind === 6) {
    const inner = embeddedV4(bare);
    if (inner) return isBlockedIp(inner);
    if (/^(::ffff:|64:ff9b::)/i.test(bare)) return true; // any other mapped/translated form: refuse
    return v6.check(bare, "ipv6");
  }
  return true; // not an IP at all -> refuse
}

/** Parse and validate the URL itself (scheme, port). Throws BlockedError. */
export function checkUrlShape(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BlockedError("That is not a valid web address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedError(`Only http:// and https:// addresses can be scanned (got ${u.protocol}).`);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!ALLOWED_PORTS.has(port)) throw new BlockedError(`Port ${port} is not allowed. The scanner only connects to ports 80, 443, 8080 and 8443.`);
  if (!u.hostname) throw new BlockedError("The address has no host name.");
  return u;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
/**
 * Optional DNS-over-HTTPS resolver (SCANNER_DOH_URL, e.g. https://cloudflare-dns.com/dns-query). Useful where the
 * system resolver returns synthetic/"fake-IP" answers (some sandboxes and corporate proxies map every name to
 * 198.18.x.x, which the guard rightly refuses). Default: the operating system resolver.
 */
async function dohResolve(host: string): Promise<{ address: string; family: number }[]> {
  const base = process.env.SCANNER_DOH_URL!;
  const q = async (type: "A" | "AAAA") => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: ctrl.signal });
      const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
      return (j.Answer ?? []).filter((a) => a.type === (type === "A" ? 1 : 28)).map((a) => ({ address: a.data, family: type === "A" ? 4 : 6 }));
    } finally { clearTimeout(t); }
  };
  const [a, aaaa] = await Promise.all([q("A"), q("AAAA").catch(() => [])]);
  return [...a, ...aaaa];
}
const defaultResolver: Resolver = async (host) => {
  if (process.env.SCANNER_DOH_URL) return dohResolve(host);
  const all = await dns.promises.lookup(host, { all: true, verbatim: true });
  return [...all.filter((a) => a.family === 4), ...all.filter((a) => a.family === 6)];
};

/** Resolve the host and require that EVERY address is public. Returns the address to connect to. */
export async function resolvePublic(hostname: string, resolver: Resolver = defaultResolver): Promise<{ address: string; family: number; all: string[] }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedError(`Blocked: ${host} is a private, loopback or reserved address. The scanner only visits public websites.`);
    return { address: host, family: net.isIP(host), all: [host] };
  }
  const name = host.toLowerCase().replace(/\.$/, "");
  if (!name.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(name) || name === "metadata.google.internal")
    throw new BlockedError(`Blocked: "${host}" is a local or internal host name. The scanner only visits public websites.`);
  let addrs: { address: string; family: number }[];
  try { addrs = await resolver(host); } catch { throw new LookupError(`The domain ${host} does not resolve (DNS lookup failed). It may not exist.`); }
  if (!addrs.length) throw new LookupError(`The domain ${host} has no IP address.`);
  const bad = addrs.find((a) => isBlockedIp(a.address));
  if (bad) throw new BlockedError(`Blocked: ${host} resolves to ${bad.address}, a private, loopback or reserved address. The scanner only visits public websites.`);
  return { ...addrs[0], all: addrs.map((a) => a.address) };
}

export class LookupError extends Error { constructor(m: string) { super(m); this.name = "LookupError"; } }

export interface TlsInfo { authorized: boolean; error: string | null; protocol: string | null; issuer: string | null; subject: string | null; validTo: string | null; daysLeft: number | null }
export interface Hop { url: string; status: number; ip: string; location: string | null; tls: TlsInfo | null; headers: Record<string, string>; ms: number }
export interface FetchResult { hops: Hop[]; finalUrl: string; status: number; headers: Record<string, string>; body: string; truncated: boolean; contentType: string; tooManyRedirects: boolean }

function oneRequest(u: URL, pinned: { address: string; family: number }): Promise<{ hop: Hop; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const mod = u.protocol === "https:" ? https : http;
    const path = u.pathname + u.search; // userinfo (user:pass@) is never sent
    let tlsInfo: TlsInfo | null = null;
    const reqOpts: https.RequestOptions = {
      method: "GET", host: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || undefined, path, agent: false,
      servername: net.isIP(u.hostname.replace(/^\[|\]$/g, "")) ? undefined : u.hostname,
      rejectUnauthorized: false, // we still read the page of a bad-cert site, but report the certificate problem
      // Pin the connection to the address we already validated (defeats DNS rebinding).
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        if (opts && opts.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
        else cb(null, pinned.address, pinned.family);
      }) as unknown as net.LookupFunction,
      headers: { "User-Agent": SCANNER_UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en" },
      timeout: TIMEOUT_MS,
    };
    const timer = setTimeout(() => { req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000} s`)); }, TIMEOUT_MS);
    const req = mod.request(reqOpts, (res) => {
      const sock = res.socket as TLSSocket;
      if (u.protocol === "https:" && sock && typeof sock.getPeerCertificate === "function") {
        const c = sock.getPeerCertificate();
        const validTo = c?.valid_to || null;
        const err = sock.authorizationError ? String(sock.authorizationError) : null;
        tlsInfo = {
          authorized: sock.authorized, error: err, protocol: sock.getProtocol?.() ?? null,
          issuer: c?.issuer ? [c.issuer.O, c.issuer.CN].filter(Boolean).join(" / ") || null : null,
          subject: c?.subject?.CN ? String(c.subject.CN) : null, validTo,
          daysLeft: validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86400000) : null,
        };
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
      const status = res.statusCode ?? 0;
      const hop: Hop = { url: u.toString(), status, ip: pinned.address, location: headers.location ?? null, tls: tlsInfo, headers, ms: 0 };
      if (status >= 300 && status < 400 && headers.location) {
        res.resume(); clearTimeout(timer); hop.ms = Date.now() - started;
        return resolve({ hop, body: Buffer.alloc(0), truncated: false });
      }
      const enc = (headers["content-encoding"] ?? "").toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      if (enc.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
      else if (enc.includes("gzip")) stream = res.pipe(zlib.createGunzip());
      else if (enc.includes("deflate")) stream = res.pipe(zlib.createInflate());
      const chunks: Buffer[] = []; let size = 0; let truncated = false; let done = false;
      const finish = () => {
        if (done) return; done = true; clearTimeout(timer); hop.ms = Date.now() - started;
        resolve({ hop, body: Buffer.concat(chunks), truncated });
      };
      stream.on("data", (d: Buffer) => {
        if (done) return;
        const room = MAX_BODY - size;
        if (d.length > room) { chunks.push(d.subarray(0, room)); size = MAX_BODY; truncated = true; finish(); req.destroy(); return; }
        chunks.push(d); size += d.length;
      });
      stream.on("end", finish);
      stream.on("error", (e: Error) => { if (chunks.length) finish(); else { clearTimeout(timer); reject(e); } });
      res.on("aborted", finish);
    });
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000} s`)));
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/** Fetch a user-supplied URL safely, following up to MAX_REDIRECTS redirects and re-checking every hop. */
export async function safeFetch(raw: string, resolver: Resolver = defaultResolver): Promise<FetchResult> {
  let u = checkUrlShape(raw);
  const hops: Hop[] = [];
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let pinned: { address: string; family: number };
    try { pinned = await resolvePublic(u.hostname, resolver); } catch (e) {
      if (i > 0 && e instanceof BlockedError) throw new BlockedError(`Redirect blocked at hop ${i + 1}: the site tried to send the scanner to ${u.host}. ${e.message}`);
      throw e;
    }
    const { hop, body, truncated } = await oneRequest(u, pinned);
    hops.push(hop);
    if (hop.status >= 300 && hop.status < 400 && hop.location) {
      if (i === MAX_REDIRECTS) return { hops, finalUrl: u.toString(), status: hop.status, headers: hop.headers, body: "", truncated: false, contentType: "", tooManyRedirects: true };
      let next: URL;
      try { next = new URL(hop.location, u); } catch { throw new LookupError(`The site redirected to an invalid address.`); }
      try { u = checkUrlShape(next.toString()); } catch (e) {
        throw new BlockedError(`Redirect blocked at hop ${i + 1}: ${(e as Error).message}`);
      }
      continue;
    }
    const contentType = hop.headers["content-type"] ?? "";
    const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
    let text: string;
    try { text = new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8", { fatal: false }).decode(body); } catch { text = body.toString("utf8"); }
    return { hops, finalUrl: u.toString(), status: hop.status, headers: hop.headers, body: text, truncated, contentType, tooManyRedirects: false };
  }
  throw new LookupError("Too many redirects.");
}
