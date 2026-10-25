/**
 * DataGuard AI - backend API (Express + TypeScript): the Express app, without a listener.
 * - Docker / local:  src/index.ts imports this app, calls listen() and starts the in-process jobs.
 * - Vercel:          this file is the function entrypoint (`export default app`); scoring runs on
 *                    ingestion, on demand, and from a Vercel Cron call to /api/cron/score.
 * Auth: httpOnly session cookie (server-side sessions) + CSRF token, bcrypt passwords, optional TOTP MFA, RBAC.
 * Every mutating action writes to the hash-chained audit log (src/lib/audit.ts).
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { config } from "./config";
import { pool } from "./db";
import { authenticate, csrfProtect, originCheck } from "./lib/auth";
import { safeLog } from "./lib/mask";
import accessLogs from "./routes/accessLogs";
import alerts from "./routes/alerts";
import analytics from "./routes/analytics";
import auditRoutes from "./routes/audit";
import auth from "./routes/auth";
import cron from "./routes/cron";
import consents from "./routes/consents";
import incidents from "./routes/incidents";
import phishing from "./routes/phishing";
import requests from "./routes/requests";
import selfcheck from "./routes/selfcheck";
import soc from "./routes/soc";
import users from "./routes/users";

const app = express();
// Which proxies may set X-Forwarded-For (used for rate limits and sign-in records). Vercel's edge overwrites the
// header, so it is trusted there; elsewhere only a local reverse proxy (e.g. the Next.js dev proxy) is trusted,
// so a client can't spoof its IP. Override with TRUST_PROXY (e.g. "1" behind one load balancer).
const tp = process.env.TRUST_PROXY;
app.set("trust proxy", tp ? (/^\d+$/.test(tp) ? Number(tp) : tp === "true" ? true : tp) : process.env.VERCEL ? true : "loopback");
app.disable("x-powered-by");
// The API only returns JSON, so its CSP can forbid everything.
app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true },
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); next(); });
app.use(cors({ origin: config.corsOrigin.split(",").map((s) => s.trim()), credentials: true, allowedHeaders: ["Content-Type", "x-csrf-token"] }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(originCheck);

// Request log: method, path and status only - no bodies, no query strings (they may contain PII or tokens)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => safeLog(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

app.get("/api/health", async (_req, res) => {
  const db = await pool.query("SELECT 1").then(() => "ok").catch(() => "down");
  res.json({ status: "ok", db, runtime: config.serverless ? "vercel" : "server" });
});
app.use("/api/auth", auth);
app.use("/api/cron", cron); // own auth: CRON_SECRET bearer or a security/admin session
app.use("/api/security", selfcheck); // public cookie probe + authenticated self-check
app.use("/api", authenticate, csrfProtect);
app.use("/api/soc", soc);
app.use("/api/phishing", phishing);
app.use("/api/consents", consents);
app.use("/api/requests", requests);
app.use("/api/incidents", incidents);
app.use("/api/alerts", alerts);
app.use("/api/access-logs", accessLogs);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/users", users);
app.use("/api", analytics);

app.use((_req, res) => res.status(404).json({ error: "not found" }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  safeLog(`error: ${err.message}`);
  const ml = err.message.startsWith("ML service") || err.name === "AbortError" || err.message.includes("fetch failed");
  res.status(ml ? 502 : 500).json({ error: ml ? "ML service unavailable" : "internal error" });
});

export default app;
