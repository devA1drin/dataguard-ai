import { query } from "../db";
import { bus } from "./events";
import { deviceHash, distanceKm, maskIp, syntheticGeo } from "./net";

/**
 * Sign-in monitoring: every attempt is stored in `login_attempts`, then simple, explainable
 * detection rules run and may raise a `security_alerts` row (mapped to MITRE ATT&CK):
 *   brute_force        >= 5 failures for one account in 10 min        T1110.001 Password Guessing
 *   password_spraying  >= 5 different accounts failing from one IP     T1110.003 Password Spraying
 *   threat_intel_match IP is on the SAMPLE threat-intel list           T1078 (success) / T1110 (failure)
 *   impossible_travel  > 900 km/h between two successful sign-ins       T1078 Valid Accounts
 *   new_device         first success from an unseen browser fingerprint T1078 Valid Accounts
 *   account_lockout    account locked after repeated failures           T1110 Brute Force
 */
export interface Attempt {
  email: string; userId: number | null; ip: string; userAgent: string; success: boolean; reason: string;
  synthetic?: boolean; geo?: { country: string; city: string; lat: number | null; lon: number | null };
}

export async function threatLookup(ip: string): Promise<{ category: string; confidence: number; indicator: string } | null> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const [t] = await query(
    `SELECT category, confidence, indicator FROM threat_intel
      WHERE indicator = $1 OR (position('/' in indicator) > 0 AND $1::inet <<= indicator::cidr)
      ORDER BY confidence DESC LIMIT 1`, [ip]);
  return t ?? null;
}

export async function raiseAlert(a: { rule: string; technique: string; severity: string; title: string; description: string;
  userId?: number | null; email?: string | null; ip?: string | null; details?: Record<string, unknown>; synthetic?: boolean; dedupeMinutes?: number }) {
  if (a.dedupeMinutes) {
    const [dup] = await query(
      `SELECT id FROM security_alerts WHERE rule=$1 AND coalesce(email,'')=coalesce($2,'') AND coalesce(ip,'')=coalesce($3,'')
          AND created_at > now() - make_interval(mins => $4) LIMIT 1`, [a.rule, a.email ?? null, a.ip ?? null, a.dedupeMinutes]);
    if (dup) return null;
  }
  const [row] = await query(
    `INSERT INTO security_alerts (rule, technique_id, severity, title, description, user_id, email, ip, details, synthetic)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [a.rule, a.technique, a.severity, a.title, a.description, a.userId ?? null, a.email ?? null, a.ip ?? null, a.details ?? {}, a.synthetic ?? false]);
  bus.emit("security_alert", row);
  return row;
}

/** Store the attempt and run the rules. `ip` is the raw IP (used for threat lookup); only a masked IP is stored
 *  unless it is a synthetic documentation-range address. */
export async function recordAttempt(at: Attempt): Promise<{ threat: string | null }> {
  const email = at.email.trim().toLowerCase().slice(0, 254);
  const threat = await threatLookup(at.ip);
  const stored = at.synthetic ? at.ip : maskIp(at.ip);
  const geo = at.geo ?? syntheticGeo(at.ip);
  const dh = deviceHash(at.userAgent);
  const [row] = await query<{ id: string }>(
    `INSERT INTO login_attempts (email, user_id, ip, user_agent, device_hash, success, reason, country, city, lat, lon, threat_match, synthetic)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [email, at.userId, stored, at.userAgent.slice(0, 300), dh, at.success, at.reason, geo.country, geo.city, geo.lat, geo.lon,
      threat?.category ?? null, at.synthetic ?? false]);
  bus.emit("login_attempt", { id: row.id });
  const syn = at.synthetic ?? false;

  if (threat) {
    await raiseAlert({ rule: "threat_intel_match", technique: at.success ? "T1078" : "T1110", severity: at.success ? "critical" : "medium",
      title: at.success ? `Successful sign-in from listed IP ${stored}` : `Sign-in attempts from listed IP ${stored}`,
      description: `The IP is on the SAMPLE threat-intel list as '${threat.category}' (confidence ${threat.confidence}).`,
      userId: at.userId, email, ip: stored, details: { threat_category: threat.category, success: at.success }, synthetic: syn, dedupeMinutes: 60 });
  }

  if (!at.success) {
    const [f] = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM login_attempts WHERE lower(email)=$1 AND NOT success AND ts > now() - interval '10 minutes'", [email]);
    if (f.n >= 5)
      await raiseAlert({ rule: "brute_force", technique: "T1110.001", severity: threat ? "critical" : "high",
        title: `Brute-force attack on ${email}`, description: `${f.n} failed sign-ins for this account in the last 10 minutes (latest from ${stored}).`,
        userId: at.userId, email, ip: stored, details: { failures: f.n, window_minutes: 10, threat_category: threat?.category ?? null },
        synthetic: syn, dedupeMinutes: 30 });
    const [s] = await query<{ n: number }>(
      "SELECT count(DISTINCT lower(email))::int AS n FROM login_attempts WHERE ip=$1 AND NOT success AND ts > now() - interval '10 minutes'", [stored]);
    if (s.n >= 5)
      await raiseAlert({ rule: "password_spraying", technique: "T1110.003", severity: "high", title: `Password spraying from ${stored}`,
        description: `${s.n} different accounts failed to sign in from this IP within 10 minutes.`, ip: stored,
        details: { distinct_accounts: s.n, window_minutes: 10 }, synthetic: syn, dedupeMinutes: 30 });
    return { threat: threat?.category ?? null };
  }

  // successful sign-in: compare with this account's previous successful sign-in
  const prev = await query<{ ts: string; lat: number | null; lon: number | null; city: string; device_hash: string }>(
    `SELECT ts, lat, lon, city, device_hash FROM login_attempts WHERE lower(email)=$1 AND success AND id <> $2 ORDER BY ts DESC LIMIT 20`,
    [email, row.id]);
  if (prev.length) {
    const p = prev[0];
    if (p.lat != null && p.lon != null && geo.lat != null && geo.lon != null) {
      const km = distanceKm(p.lat, p.lon, geo.lat, geo.lon);
      const hours = Math.max((Date.now() - new Date(p.ts).getTime()) / 3600_000, 1 / 60);
      if (km > 500 && km / hours > 900)
        await raiseAlert({ rule: "impossible_travel", technique: "T1078", severity: "high", title: `Impossible travel for ${email}`,
          description: `Signed in from ${p.city} and then ${geo.city} (${Math.round(km)} km) ${Math.round(hours * 60)} minutes later.`,
          userId: at.userId, email, ip: stored, details: { from: p.city, to: geo.city, km: Math.round(km), minutes: Math.round(hours * 60) },
          synthetic: syn, dedupeMinutes: 60 });
    }
    if (!prev.some((x) => x.device_hash === dh))
      await raiseAlert({ rule: "new_device", technique: "T1078", severity: "low", title: `New device for ${email}`,
        description: "First successful sign-in from this browser/device fingerprint.", userId: at.userId, email, ip: stored,
        details: { device: dh }, synthetic: syn, dedupeMinutes: 60 });
  }
  return { threat: threat?.category ?? null };
}
