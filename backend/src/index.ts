/**
 * Long-running server entrypoint (Docker / local dev): listens on PORT and runs the
 * in-process background jobs (periodic scorer + optional access-event simulator).
 * On Vercel the function entrypoint is src/app.ts instead (no listener, no timers).
 */
import app from "./app";
import { config } from "./config";
import { startScorer, startSimulator } from "./jobs/scorer";
import { safeLog } from "./lib/mask";

app.listen(config.port, () => {
  safeLog(`DataGuard API listening on :${config.port}`);
  startScorer();
  if (config.simulate) startSimulator();
});
