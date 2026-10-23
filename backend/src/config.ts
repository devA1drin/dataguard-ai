/** Centralised configuration from environment variables (see ../.env.example). */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://dataguard:dataguard@localhost:5432/dataguard",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
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
