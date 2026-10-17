import { capabilities, env } from "@/lib/env";
import { createosReachable } from "@/lib/createos/sandbox-runner";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What is actually wired. Used by the dashboard header and by `npm run smoke`. */
export async function GET() {
  const createos = await createosReachable();
  return ok({
    appUrl: env.appUrl,
    x402Network: env.x402.network,
    facilitator: env.x402.facilitatorUrl,
    commissionPriceUsd: env.x402.commissionPriceUsd,
    createosReachable: createos,
    capabilities: capabilities(),
  });
}
