import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // /api/analysis/* and /api/agent/* are handled by runtime API route handlers
  // in src/app/api/{analysis,agent}/[...path]/route.ts.
  // Those handlers read ANALYSIS_SERVICE_URL / AGENT_URL at request time,
  // which is required for Docker where the env vars are only available at
  // runtime (not during `next build`).
};

export default nextConfig;
