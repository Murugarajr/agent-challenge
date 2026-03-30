import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow the browser to call the analysis service via the Next.js dev proxy
  // when running locally. In Docker/production the env vars point directly.
  async rewrites() {
    return [
      {
        source: "/api/analysis/:path*",
        destination: `${process.env.NEXT_PUBLIC_ANALYSIS_SERVICE_URL ?? "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
