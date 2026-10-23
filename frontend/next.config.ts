import type { NextConfig } from "next";

/**
 * All pages are client-rendered dashboards that talk to the backend API
 * (or to bundled fixtures when NEXT_PUBLIC_DEMO_MODE=true).
 * output: "standalone" keeps the Docker image small.
 */
const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
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
