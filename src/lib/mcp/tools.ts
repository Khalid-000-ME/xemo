import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { economics } from "@/lib/ledger";

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Tools Xemo contributes to a PayBox-connected agent.
 *
 * `quote_app_build` deliberately does not build anything. It returns the x402
 * terms for the paid endpoint, because spending is PayBox's job: the agent
 * takes these terms to `pay_x402`, gets a payment header, and calls the
 * resource itself. Quoting the price before anything is spent is what the
 * PayBox x402 skill asks of a well-behaved integration.
 */
export function tools(): McpTool[] {
  return [
    {
      name: "quote_app_build",
      title: "Quote an app build",
      description:
        "Return the x402 payment terms for commissioning a deployed, monetized onchain product (stablecoin, tokenization or prediction-market tooling). Read-only: " +
        "nothing is built and nothing is spent. Show the user `priceUsd` before paying.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the product should be, in plain English." },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      handler: async (input) => ({
        service: env.x402.serviceName,
        resource: `${env.appUrl}/api/x402/commission`,
        method: "POST",
        priceUsd: env.x402.commissionPriceUsd,
        network: env.x402.network,
        body: { prompt: str(input.prompt) ?? "", productName: null, priceUsd: 5 },
        delivers: [
          "a live public URL for the generated app",
          "a Stripe product and price so humans can buy it",
          "an x402 endpoint so other agents can buy it",
          "a build timeline and a revenue/cost ledger",
        ],
        howToPay:
          "Call `pay_x402` with this resource to obtain an X-PAYMENT header, then POST the body to `resource` " +
          "with that header. Builds typically take 60-180 seconds.",
      }),
    },
    {
      name: "get_build",
      title: "Get a build",
      description: "Look up the status, URLs and economics of a build Xemo produced. Read-only.",
      inputSchema: {
        type: "object",
        properties: { buildId: { type: "string", description: "The build id returned when it was commissioned." } },
        required: ["buildId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const buildId = str(input.buildId);
        if (!buildId) throw new Error("buildId is required");
        const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
        if (!build) throw new Error(`no build with id ${buildId}`);
        return {
          buildId: build.id,
          status: build.status,
          productName: build.productName,
          appUrl: build.appUrl,
          agentEndpoint: build.agentEndpointUrl,
          humanPriceUsd: build.humanPriceUsd,
          agentPriceUsd: build.agentPriceUsd,
          timelineUrl: `${env.appUrl}/build/${build.id}`,
          economics: await economics(build.id),
        };
      },
    },
    {
      name: "list_apps",
      title: "List deployed apps",
      description: "List the onchain apps Xemo has deployed, newest first. Read-only.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", minimum: 1, maximum: 50, description: "How many to return." } },
        additionalProperties: false,
      },
      handler: async (input) => {
        const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
        const rows = await db
          .select({
            buildId: builds.id,
            status: builds.status,
            productName: builds.productName,
            appUrl: builds.appUrl,
            agentEndpoint: builds.agentEndpointUrl,
            humanPriceUsd: builds.humanPriceUsd,
            agentPriceUsd: builds.agentPriceUsd,
          })
          .from(builds)
          .orderBy(desc(builds.createdAt))
          .limit(limit);
        return { count: rows.length, apps: rows };
      },
    },
  ];
}
