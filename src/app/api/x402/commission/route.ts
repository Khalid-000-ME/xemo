import { after, NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { startBuild, ValidationError } from "@/lib/agent/orchestrator";
import {
  accepts,
  facilitatorLabel,
  facilitatorSupport,
  resourceServer,
  x402Configured,
} from "@/lib/x402/server";
import { env, MissingCredentialsError } from "@/lib/env";
import { fail, numOr, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Xemo — the x402-gated service a PayBox-connected agent buys.
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
      wait: {
        type: "boolean",
        description:
          "Wait for the build to finish and return the live app (default). Set false to receive the " +
          "buildId as soon as the job is accepted, then poll /api/builds/{buildId}.",
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
      agentEndpoint: "https://xemo.example/api/x402/apps/af_abc123",
      humanPriceUsd: 5,
      agentPriceUsd: 0.02,
      buildSeconds: 74,
    },
    schema: {
      type: "object",
      required: ["buildId", "status"],
      properties: {
        buildId: { type: "string" },
        status: { type: "string", enum: ["live", "building", "failed"] },
        productName: { type: "string" },
        appUrl: { type: "string" },
        agentEndpoint: { type: "string" },
        humanPriceUsd: { type: "number" },
        agentPriceUsd: { type: "number" },
        buildSeconds: { type: "number" },
        pollUrl: { type: "string" },
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
    const { buildId, done, provisioned } = await startBuild({
      prompt,
      productName: str(body.productName),
      priceUsd: body.priceUsd === undefined ? undefined : numOr(body.priceUsd, 5),
      template: str(body.template),
      origin: "x402",
      ...(paymentId
        ? { commission: { amountUsd: PRICE, externalId: `x402:${hash(paymentId)}`, provider: "x402" as const } }
        : {}),
    });

    // A caller on a short request budget — PayBox's hosted runtime, for one —
    // asks not to wait. Every cheap check (request shape, configured rails) has
    // already run and thrown, so accepting the job here is not accepting one we
    // know will fail.
    if (body.wait === false) {
      // The response below ends this request while the build is still running.
      // Without `after`, a serverless platform may freeze the function the
      // moment it answers, and the build the agent just paid for would stall.
      after(() => done.then(() => undefined, () => undefined));

      // Accepting the job is a promise the payment will be honoured, so do not
      // accept until the first costly step has actually worked. Planning and
      // sandbox creation take seconds; an exhausted quota, a bad model key or
      // a dead CreateOS all surface here, as a non-2xx the facilitator will not
      // settle, instead of as a failed build after the agent has paid.
      try {
        await Promise.race([
          provisioned,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("the build did not start within 45 seconds")), 45_000),
          ),
        ]);
      } catch (err) {
        return fail(502, "BUILD_NOT_STARTED", err instanceof Error ? err.message : "the build could not start", {
          buildId,
        });
      }

      return NextResponse.json(
        {
          buildId,
          status: "building",
          appUrl: null,
          agentEndpoint: `${env.appUrl}/api/x402/apps/${buildId}`,
          pollUrl: `${env.appUrl}/api/builds/${buildId}`,
          timelineUrl: `${env.appUrl}/build/${buildId}`,
          humanPriceUsd: body.priceUsd === undefined ? 5 : numOr(body.priceUsd, 5),
          agentPriceUsd: env.x402.generatedAppPriceUsd,
          note: "Build accepted. Poll pollUrl until status is live or failed; it usually takes under a minute.",
        },
        { status: 200 },
      );
    }

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

/**
 * A paid endpoint must never hang. If the facilitator cannot settle on the
 * configured network, say so immediately and precisely — a 503 here is also
 * what stops an agent being charged for a resource we cannot honour.
 */
async function guardFacilitator(): Promise<Response | null> {
  const support = await facilitatorSupport();
  if (support.ok) return null;
  return fail(503, "FACILITATOR_UNSUPPORTED", support.message, {
    network: env.x402.network,
    facilitator: facilitatorLabel(),
    ...(support.networks ? { facilitatorSupports: support.networks } : {}),
  });
}

const paidRoute = x402Configured()
  ? withX402(
      handler,
      {
        "/api/x402/commission": {
          accepts: accepts(PRICE),
          // Pinned to the configured public origin rather than derived from the
          // request. Behind a proxy or tunnel the inbound Host is the internal
          // one, which would advertise a resource URL the payer cannot reach —
          // and which would not match the URL in an agent's payment proposal.
          resource: `${env.appUrl}/api/x402/commission`,
          description: "Commission a deployed, Stripe-and-x402 monetized micro-SaaS from one prompt.",
          mimeType: "application/json",
          serviceName: env.x402.serviceName,
          tags: ["merchant-tools", "deploy", "codegen", "saas"],
          ...(env.x402.iconUrl ? { iconUrl: env.x402.iconUrl } : {}),
          extensions: discovery,
        },
      },
      resourceServer(),
      undefined,
      undefined,
      // Do NOT sync with the facilitator at startup. When the configured
      // network is unsupported, that sync throws RouteConfigurationError and
      // takes the whole server down — a payments misconfiguration should
      // degrade one endpoint, not the platform. `guardFacilitator` reports the
      // same problem as a precise 503 on this route alone.
      false,
    )
  : async () =>
      fail(
        503,
        "X402_NOT_CONFIGURED",
        "X402_PAY_TO is not set, so this service cannot be sold. Set it to the address payments should settle to.",
      );

export async function POST(request: NextRequest) {
  const blocked = await guardFacilitator();
  if (blocked) return blocked;
  return paidRoute(request);
}
