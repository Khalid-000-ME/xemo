import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { fulfil } from "@/lib/agent/fulfil";
import { post } from "@/lib/ledger";
import { accepts, resourceServer, x402Configured } from "@/lib/x402/server";
import { env } from "@/lib/env";
import { fail, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The agent rail for every generated app.
 *
 * This is the second half of the product's claim: an app AgentFoundry ships
 * sells to humans through Stripe Checkout *and* to agents through x402, from
 * the moment it goes live. The platform is merchant of record for both, which
 * is why one gateway serves every build.
 */
const PRICE = env.x402.generatedAppPriceUsd;

const discovery = declareDiscoveryExtension({
  bodyType: "json",
  method: "POST",
  input: { input: "The text to analyse, at least 40 characters." },
  inputSchema: {
    type: "object",
    required: ["input"],
    properties: {
      input: { type: "string", minLength: 40, maxLength: 60_000, description: "The text to analyse." },
    },
    additionalProperties: false,
  },
  pathParams: { buildId: "af_abc123" },
  output: {
    example: { buildId: "af_abc123", productName: "ResumeForge", result: { overallScore: 78 } },
    schema: {
      type: "object",
      required: ["buildId", "result"],
      properties: {
        buildId: { type: "string" },
        productName: { type: "string" },
        result: { type: "object", additionalProperties: true },
        simulated: { type: "boolean" },
      },
    },
  },
});

async function handler(req: NextRequest): Promise<NextResponse> {
  // Next 16 gives dynamic segments through the context argument, but `withX402`
  // wraps a single-argument handler, so the id is read from the URL instead.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const buildId = segments[segments.length - 1] ?? "";

  const body = await readJson(req);
  const input = str(body.input);
  if (!input) return fail(400, "INPUT_REQUIRED", "input is required");
  if (input.length < 40) return fail(400, "INPUT_TOO_SHORT", "input must be at least 40 characters");
  if (input.length > 60_000) return fail(413, "INPUT_TOO_LONG", "input must be under 60,000 characters");

  const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
  if (!build) return fail(404, "BUILD_NOT_FOUND", `no app with id ${buildId}`);
  if (build.status !== "live") return fail(409, "APP_NOT_LIVE", `app ${buildId} is ${build.status}, not live`);

  const paymentId = req.headers.get("x-payment")?.slice(0, 120) ?? null;

  try {
    const { result, simulated, note } = await fulfil({ buildId, input, rail: "agent" });

    await post({
      buildId,
      provider: "x402",
      rail: "agent",
      direction: "inflow",
      amountUsd: PRICE,
      purpose: "agent_api_call",
      externalId: paymentId ? `x402:${buildId}:${hash(paymentId)}` : null,
      metadata: { rail: "agent" },
    });

    return NextResponse.json(
      {
        buildId,
        productName: build.productName,
        result,
        ...(simulated ? { simulated: true, note } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    // Non-2xx means the facilitator never settles, so a failed call is free.
    return fail(502, "FULFILMENT_FAILED", err instanceof Error ? err.message : "could not fulfil the request");
  }
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export const POST = x402Configured()
  ? withX402(
      handler,
      {
        "/api/x402/apps/[buildId]": {
          accepts: accepts(PRICE),
          description: "Call a micro-SaaS built by AgentFoundry, priced per request for agents.",
          mimeType: "application/json",
          resource: {
            serviceName: `${env.x402.serviceName} app`,
            tags: ["analysis", "saas", "agent-rail"],
            ...(env.x402.iconUrl ? { iconUrl: env.x402.iconUrl } : {}),
          },
          extensions: discovery,
        },
      },
      resourceServer(),
    )
  : async () => fail(503, "X402_NOT_CONFIGURED", "X402_PAY_TO is not set, so the agent rail cannot be sold.");
