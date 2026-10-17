import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public catalogue of deployed apps.
 *
 * Read-only and unauthenticated by design: this is the shop window agents and
 * judges browse. It exposes no prompts, no generated source and no buyer input.
 */
export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 10, 1), 50);

  const rows = await db
    .select({
      buildId: builds.id,
      status: builds.status,
      productName: builds.productName,
      appUrl: builds.appUrl,
      agentEndpoint: builds.agentEndpointUrl,
      humanPriceUsd: builds.humanPriceUsd,
      agentPriceUsd: builds.agentPriceUsd,
      createdAt: builds.createdAt,
    })
    .from(builds)
    .orderBy(desc(builds.createdAt))
    .limit(limit);

  return ok({ count: rows.length, apps: rows });
}
