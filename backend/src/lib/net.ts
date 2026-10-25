import crypto from "crypto";
import { Request } from "express";

/** Client IP as seen by Express (`trust proxy` is on, so X-Forwarded-For from Vercel is honoured). */
export function clientIp(req: Request): string {
  return (req.ip ?? "").replace(/^::ffff:/, "") || "unknown";
}

/** Store only a masked IP for real users (last IPv4 octet / last 80 bits of IPv6 removed). */
export function maskIp(ip: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, ".0");
  if (ip.includes(":")) {
    if (ip === "::1") return ip; // loopback (local development)
    const head = ip.split("::")[0].split(":").filter(Boolean);
    return head.slice(0, 3).join(":") + "::"; // keep the /48 network prefix only
  }
  return ip;
}

export function deviceHash(ua: string): string {
  return crypto.createHash("sha256").update(ua || "unknown").digest("hex").slice(0, 16);
}

/** Very small user-agent summary for the sessions list ("Chrome on Windows"). */
export function uaLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : /curl|python|Go-http|bot|Hydra/i.test(ua) ? "Script/bot" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown OS";
  return `${b} on ${os}`;
}

/**
 * SYNTHETIC geolocation. No real geolocation service or database is used: a real client IP is
 * mapped deterministically to one Metro Manila city (so real users never trigger
 * "impossible travel" by accident). Documentation-range IPs (RFC 5737) used by the
 * synthetic seed/simulator are reported as unknown.
 */
const METRO = [["Manila", 14.5995, 120.9842], ["Quezon City", 14.676, 121.0437], ["Makati", 14.5547, 121.0244],
  ["Pasig", 14.5764, 121.0851], ["Taguig", 14.5176, 121.0509]] as const;
export function syntheticGeo(ip: string): { country: string; city: string; lat: number | null; lon: number | null } {
  if (/^192\.0\.2\./.test(ip)) return { country: "ZZ", city: "Unknown (sample)", lat: null, lon: null };
  const h = crypto.createHash("sha256").update(maskIp(ip)).digest()[0] % METRO.length;
  const [city, lat, lon] = METRO[h];
  return { country: "PH", city, lat, lon };
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
