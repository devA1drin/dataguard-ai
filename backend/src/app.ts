/**
 * DataGuard AI - backend API (Express + TypeScript): the Express app, without a listener.
 * - Docker / local:  src/index.ts imports this app, calls listen() and starts the in-process jobs.
 * - Vercel:          this file is the function entrypoint (`export default app`); scoring runs on
 *                    ingestion, on demand, and from a Vercel Cron call to /api/cron/score.
 * Auth: JWT bearer tokens, bcrypt-hashed passwords, role-based access control.
 * Every mutating action writes to the hash-chained audit log (src/lib/audit.ts).
 */
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { config } from "./config";
import { pool } from "./db";
import { authenticate } from "./lib/auth";
import { safeLog } from "./lib/mask";
import accessLogs from "./routes/accessLogs";
import alerts from "./routes/alerts";
import analytics from "./routes/analytics";
import auditRoutes from "./routes/audit";
import auth from "./routes/auth";
import cron from "./routes/cron";
import consents from "./routes/consents";
import incidents from "./routes/incidents";
import requests from "./routes/requests";
import users from "./routes/users";

const app = express();
app.set("trust proxy", true);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin.split(","), credentials: false }));
app.use(express.json({ limit: "1mb" }));

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
app.use("/api/cron", cron); // own auth: CRON_SECRET bearer or a security/admin JWT
app.use("/api", authenticate);
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
