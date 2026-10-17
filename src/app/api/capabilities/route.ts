import { env, readiness } from "@/lib/env";
import { createosReachable } from "@/lib/createos/sandbox-runner";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which rails are wired, and whether CreateOS actually answers.
 *
 * Read by the dashboard header and by `npm run smoke`, so both report the same
 * thing. `buildReady` is false when any required rail is missing — a build
 * refuses to start in that state rather than producing simulated numbers.
 */
export async function GET() {
  const rails = readiness();
  const createos = await createosReachable();

  return ok({
    appUrl: env.appUrl,
    model: env.agentModel,
    x402Network: env.x402.network,
    facilitator: env.x402.facilitatorUrl,
    commissionPriceUsd: env.x402.commissionPriceUsd,
    generatedAppPriceUsd: env.x402.generatedAppPriceUsd,
    createosReachable: createos,
    buildReady: rails.filter((r) => r.blocking).every((r) => r.ready),
    missing: rails.filter((r) => !r.ready).flatMap((r) => r.missing),
    rails,
  });
}
