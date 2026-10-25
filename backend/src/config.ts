/** Centralised configuration from environment variables (see ../.env.example). */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://dataguard:dataguard@localhost:5432/dataguard",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  /** sign-in session lifetime (hours); the cookie and server-side session expire together */
  sessionHours: Number(process.env.SESSION_HOURS ?? 8),
  /** whoever signs up with this e-mail while NO admin exists becomes the first admin */
  adminEmail: (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
  /** account lockout: N consecutive failures -> locked for LOCK_MINUTES */
  lockThreshold: Number(process.env.LOCK_THRESHOLD ?? 5),
  lockMinutes: Number(process.env.LOCK_MINUTES ?? 10),
  /** per-IP rate limit: max failed sign-ins per 15 minutes */
  ipFailLimit: Number(process.env.LOGIN_IP_FAIL_LIMIT ?? 20),
  /** comma-separated URLs the security self-check may scan (defaults to this deployment) */
  selfCheckUrls: process.env.SELF_CHECK_URL ?? "",
  mlUrl: (process.env.ML_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  /** risk_score (0..1) at or above which an access event is flagged for human review */
  alertThreshold: Number(process.env.ALERT_THRESHOLD ?? 0.5),
  scoreIntervalMs: Number(process.env.SCORE_INTERVAL_MS ?? 10000),
  /** when true, a simulator inserts a synthetic access event every SIMULATE_INTERVAL_MS */
  simulate: (process.env.SIMULATE_ACCESS_LOGS ?? "true") === "true",
  simulateIntervalMs: Number(process.env.SIMULATE_INTERVAL_MS ?? 20000),
  /** Vercel Cron sends "Authorization: Bearer $CRON_SECRET" to /api/cron/score */
  cronSecret: process.env.CRON_SECRET ?? "",
  /** true when running as a Vercel Function (no listener, no in-process timers) */
  serverless: Boolean(process.env.VERCEL),
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS ?? (process.env.VERCEL ? 60000 : 20000)),
};

if (config.serverless && !process.env.JWT_SECRET) {
  // Never sign tokens with the public development default on a hosted deployment.
  throw new Error("[config] JWT_SECRET must be set on Vercel");
}
if (config.jwtSecret === "dev-only-change-me" && process.env.NODE_ENV === "production") {
  console.warn("[config] WARNING: JWT_SECRET is the development default. Set a strong secret.");
}
