import type { NextConfig } from "next";

/**
 * All pages are client-rendered dashboards that talk to the backend API
 * (or to bundled fixtures when NEXT_PUBLIC_DEMO_MODE=true).
 * output: "standalone" keeps the Docker image small.
 */
const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  /**
   * Optional same-origin API proxy for local development (API_PROXY_URL=http://localhost:4000 with
   * NEXT_PUBLIC_API_URL=/). On Vercel, vercel.json routes /api/* to the backend instead.
   */
  async rewrites() {
    const target = process.env.API_PROXY_URL?.replace(/\/+$/, "");
    return target ? [{ source: "/api/:path*", destination: `${target}/api/:path*` }] : [];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
