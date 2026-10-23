/**
 * PII masking for logs. Application logs must never contain raw emails, phone numbers,
 * names or tokens. Use `safeLog()` instead of console.log for anything request-derived.
 */
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /(\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?(\d{4})/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SENSITIVE_KEYS = new Set(["password", "password_hash", "token", "authorization", "full_name", "phone", "email"]);

export function maskString(s: string): string {
  return s.replace(JWT, "[jwt]").replace(EMAIL, "$1***@$2").replace(PHONE, "+63 9** *** $2");
}

export function maskEmail(email: string): string {
  return maskString(email);
}

export function maskValue(v: unknown): unknown {
  if (typeof v === "string") return maskString(v);
  if (Array.isArray(v)) return v.map(maskValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) =>
        SENSITIVE_KEYS.has(k.toLowerCase()) ? [k, typeof val === "string" && k === "email" ? maskEmail(val) : "[redacted]"] : [k, maskValue(val)],
      ),
    );
  }
  return v;
}

export function safeLog(msg: string, meta?: unknown) {
  const line = meta === undefined ? maskString(msg) : `${maskString(msg)} ${JSON.stringify(maskValue(meta))}`;
  console.log(`[${new Date().toISOString()}] ${line}`);
}
