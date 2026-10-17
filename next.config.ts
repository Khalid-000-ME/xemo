import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and the CreateOS SDK are server-only native/node deps.
  serverExternalPackages: ["better-sqlite3", "@nodeops-createos/sandbox"],
  outputFileTracingIncludes: {
    // The agent reads template files at runtime to generate apps.
    "/api/agent/**": ["./templates/**/*"],
    "/api/x402/**": ["./templates/**/*"],
    "/api/mcp/**": ["./templates/**/*"],
  },
};

export default nextConfig;
