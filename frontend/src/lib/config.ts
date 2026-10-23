/** Runtime configuration. NEXT_PUBLIC_* vars are inlined at build time. */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
/** Backend base URL. "/" (or empty) means same origin, e.g. on Vercel where /api/* is routed to the backend service. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
/** "sse" (long-running backend, Docker) or "poll" (serverless backend, where an in-process event bus can't fan out). */
export const ALERT_TRANSPORT = process.env.NEXT_PUBLIC_ALERT_TRANSPORT === "poll" ? "poll" : "sse";
