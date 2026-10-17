import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, generatedFiles } from "@/lib/db/schema";
import { listEvents } from "@/lib/events";
import { economics } from "@/lib/ledger";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;

  const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
  if (!build) return fail(404, "BUILD_NOT_FOUND", `no build with id ${buildId}`);

  const [events, files, econ] = await Promise.all([
    listEvents(buildId),
    db
      .select({
        path: generatedFiles.path,
        language: generatedFiles.language,
        bytes: generatedFiles.bytes,
      })
      .from(generatedFiles)
      .where(eq(generatedFiles.buildId, buildId))
      .orderBy(asc(generatedFiles.path)),
    economics(buildId),
  ]);

  return ok({
    buildId: build.id,
    origin: build.origin,
    status: build.status,
    statusDetail: build.statusDetail,
    productName: build.productName,
    template: build.template,
    brandColor: build.brandColor,
    simulated: build.simulated,
    appUrl: build.appUrl,
    sandboxId: build.sandboxId,
    humanPriceUsd: build.humanPriceUsd,
    agentPriceUsd: build.agentPriceUsd,
    agentEndpointUrl: build.agentEndpointUrl,
    stripeProductId: build.stripeProductId,
    stripePriceId: build.stripePriceId,
    plan: build.plan,
    files,
    events,
    economics: econ,
  });
}
