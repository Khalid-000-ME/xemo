import { after } from "next/server";
import { startBuild, ValidationError } from "@/lib/agent/orchestrator";
import { MissingCredentialsError } from "@/lib/env";
import { fail, numOr, ok, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dashboard entry point. Returns as soon as the build is queued so the client
 * can follow the timeline; the build itself continues in the background.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const prompt = str(body.prompt);
  if (!prompt) return fail(400, "PROMPT_REQUIRED", "a product brief is required");

  try {
    const { buildId, done } = await startBuild({
      prompt,
      productName: str(body.productName),
      priceUsd: body.priceUsd === undefined ? undefined : numOr(body.priceUsd, 5),
      template: str(body.template),
      origin: "dashboard",
    });

    // On a serverless platform a function may be frozen the moment its response
    // is sent, which would strand the build mid-flight. `after` keeps the
    // invocation alive until the build settles; locally it is a plain callback.
    after(() => done.then(() => undefined));

    return ok({ buildId, status: "queued", timelineUrl: `/build/${buildId}` }, 202);
  } catch (err) {
    if (err instanceof ValidationError) return fail(400, err.code, err.message);
    if (err instanceof MissingCredentialsError) {
      return fail(503, err.code, err.message, { missing: err.missing });
    }
    return fail(500, "BUILD_START_FAILED", err instanceof Error ? err.message : "could not start the build");
  }
}
