import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships a native binding for local files; the CreateOS SDK is node-only.
  serverExternalPackages: ["@libsql/client", "@nodeops-createos/sandbox"],
  outputFileTracingIncludes: {
    // The agent reads template files at runtime to generate apps.
    "/api/agent/**": ["./templates/**/*"],
    "/api/x402/**": ["./templates/**/*"],
    "/api/mcp/**": ["./templates/**/*"],
  },
};

export default nextConfig;
