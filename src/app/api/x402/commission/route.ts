import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { startBuild, ValidationError } from "@/lib/agent/orchestrator";
import { accepts, resourceServer, x402Configured } from "@/lib/x402/server";
import { env, MissingCredentialsError } from "@/lib/env";
import { fail, numOr, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * AppFactory — the x402-gated service a PayBox-connected agent buys.
 *
 * An unpaid call answers 402 with payment requirements; a call carrying a valid
 * `X-PAYMENT` header commissions a real build and returns the live app. The
 * bazaar discovery extension is what lets PayBox's `discover_services` find
 * this resource once a payment has settled through the facilitator.
 */
const PRICE = env.x402.commissionPriceUsd;

const discovery = declareDiscoveryExtension({
  bodyType: "json",
  input: {
    prompt: "Build a paid AI resume reviewer that charges $5 per review",
    productName: "ResumeForge",
    priceUsd: 5,
  },
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        minLength: 10,
        maxLength: env.limits.maxPromptChars,
        description: "What the product should be, in plain English.",
      },
      productName: { type: "string", maxLength: 60, description: "Optional name for the product." },
      priceUsd: {
        type: "number",
        minimum: env.limits.minPriceUsd,
        maximum: env.limits.maxPriceUsd,
        description: "What a human buyer pays per unit in the generated app.",
      },
    },
    additionalProperties: false,
  },
  output: {
    example: {
      buildId: "af_abc123",
      status: "live",
      productName: "ResumeForge",
      appUrl: "https://sandbox-abc.sb.createos.sh",
      agentEndpoint: "https://agentfoundry.example/api/x402/apps/af_abc123",
      humanPriceUsd: 5,
      agentPriceUsd: 0.02,
      buildSeconds: 74,
    },
    schema: {
      type: "object",
      required: ["buildId", "status"],
      properties: {
        buildId: { type: "string" },
        status: { type: "string", enum: ["live", "failed"] },
        productName: { type: "string" },
        appUrl: { type: "string" },
        agentEndpoint: { type: "string" },
        humanPriceUsd: { type: "number" },
        agentPriceUsd: { type: "number" },
        buildSeconds: { type: "number" },
      },
    },
  },
});

async function handler(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  const prompt = str(body.prompt);
  if (!prompt) return fail(400, "PROMPT_REQUIRED", "a product brief is required");

  // The payment is already verified by the time this runs; settlement happens
  // only if we return a 2xx, so a failed build is not charged for.
  const paymentId = req.headers.get("x-payment")?.slice(0, 120) ?? null;
  const startedAt = Date.now();

  try {
    const { buildId, done } = await startBuild({
      prompt,
      productName: str(body.productName),
      priceUsd: body.priceUsd === undefined ? undefined : numOr(body.priceUsd, 5),
      template: str(body.template),
      origin: "x402",
      ...(paymentId
        ? { commission: { amountUsd: PRICE, externalId: `x402:${hash(paymentId)}`, provider: "x402" as const } }
        : {}),
    });

    const outcome = await done;

    if (outcome.status === "failed") {
      // A non-2xx keeps the facilitator from settling: the agent is not billed
      // for a build that did not ship.
      return fail(502, "BUILD_FAILED", outcome.error ?? "the build did not reach a live state", { buildId });
    }

    return NextResponse.json(
      {
        buildId,
        status: outcome.status,
        productName: outcome.spec?.productName ?? null,
        tagline: outcome.spec?.tagline ?? null,
        appUrl: outcome.appUrl,
        agentEndpoint: outcome.agentEndpoint,
        humanCheckout: outcome.appUrl,
        humanPriceUsd: body.priceUsd === undefined ? 5 : numOr(body.priceUsd, 5),
        agentPriceUsd: env.x402.generatedAppPriceUsd,
        buildSeconds: Math.round((Date.now() - startedAt) / 1000),
        timelineUrl: `${env.appUrl}/build/${buildId}`,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ValidationError) return fail(400, err.code, err.message);
    if (err instanceof MissingCredentialsError) {
      // Non-2xx, so the facilitator never settles: an agent is not charged
      // because the operator left a credential unset.
      return fail(503, err.code, err.message, { missing: err.missing });
    }
    return fail(500, "COMMISSION_FAILED", err instanceof Error ? err.message : "could not commission the build");
  }
}

/** Short stable id from the payment header, for ledger idempotency. */
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
        "/api/x402/commission": {
          accepts: accepts(PRICE),
          description: "Commission a deployed, Stripe-and-x402 monetized micro-SaaS from one prompt.",
          mimeType: "application/json",
          serviceName: env.x402.serviceName,
          tags: ["merchant-tools", "deploy", "codegen", "saas"],
          ...(env.x402.iconUrl ? { iconUrl: env.x402.iconUrl } : {}),
          extensions: discovery,
        },
      },
      resourceServer(),
    )
  : async () =>
      fail(
        503,
        "X402_NOT_CONFIGURED",
        "X402_PAY_TO is not set, so this service cannot be sold. Set it to the address payments should settle to.",
      );
