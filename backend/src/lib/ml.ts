import { config } from "../config";

/** Thin client for the Python ML service. All ML calls go through the backend (never directly from the browser). */
export async function ml<T = any>(path: string, body?: unknown, timeoutMs = config.mlTimeoutMs): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.mlUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ML service ${path} -> ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface AccessLogRow {
  id: string | number; hour_of_day: number; records_accessed: number; distinct_customers: number;
  export_flag: number; employee_role: string; off_hours: number; is_weekend: number; failed_logins: number;
}

export const toMlEvent = (r: AccessLogRow) => ({
  id: String(r.id), hour_of_day: r.hour_of_day, records_accessed: r.records_accessed,
  distinct_customers: r.distinct_customers, export_flag: r.export_flag, role: r.employee_role,
  off_hours: r.off_hours, is_weekend: r.is_weekend, failed_logins: r.failed_logins,
});
