/**
 * AppFactory — a PayBox marketplace plugin.
 *
 * Commission a real micro-SaaS. Describe a product and AgentFoundry writes it,
 * tests it inside a Firecracker microVM, deploys it to a public URL, and opens
 * both payment rails on the finished app: Stripe Checkout for people, and an
 * x402 endpoint so other agents can buy it too.
 *
 * Design notes for reviewers:
 *
 * - `commission_app` makes **no network call**. It returns an unsigned x402
 *   proposal and nothing else. PayBox fetches the live 402, checks it against
 *   the proposal, and pays only with the user's approval. This plugin never
 *   sees a key, a wallet, or a signature.
 * - The two read tools are the recovery path. A build takes longer than one
 *   sandbox operation is allowed to run, so the paid request returns a build id
 *   immediately and `get_build` follows it to completion.
 * - Everything is bounded: explicit timeouts, capped response reads, and no
 *   network at discovery time.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { atomicAmount, proposeX402, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";

/**
 * Where AgentFoundry runs. Configured as a plugin variable in the portal, and
 * the same hostname must be added under network access.
 */
const API_BASE = (process.env.APPFACTORY_API_URL ?? "https://appfactory.example").replace(/\/+$/, "");

/** USDC has six decimals on both Base and Solana. */
const USDC_DECIMALS = 6;

/** Only these two chains are accepted for an x402 proposal. */
const CHAINS = ["eip155:8453", "solana:mainnet"] as const;

const buildIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "A build id contains only letters, digits, underscore and hyphen.");

/** Bounded fetch: the hosted runtime gives an operation ten seconds in total. */
async function readJson(path: string, timeoutMs = 7000): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.text();
  if (body.length > 256 * 1024) throw new Error("AppFactory returned an unexpectedly large response.");

  if (!response.ok) {
    let message = `AppFactory responded ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // keep the status-only message
    }
    throw new Error(message);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("AppFactory returned a response that was not JSON.");
  }
}

function textAnd<T extends Record<string, unknown>>(text: string, structuredContent: T) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function failure(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

const economicsSchema = z
  .object({
    revenueUsd: z.number(),
    humanRevenueUsd: z.number(),
    agentRevenueUsd: z.number(),
    costUsd: z.number(),
    marginUsd: z.number(),
  })
  .loose();

const buildSchema = z
  .object({
    buildId: z.string(),
    status: z.string(),
    productName: z.string(),
    appUrl: z.string().nullable(),
    agentEndpoint: z.string().nullable(),
    humanPriceUsd: z.number(),
    agentPriceUsd: z.number(),
    economics: economicsSchema.optional(),
  })
  .loose();

function createServer() {
  const server = new McpServer(
    { name: "appfactory", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  // ── 1. Commission a build (x402 proposal, no network, no spend here) ───────
  server.registerTool(
    "commission_app",
    {
      title: "Commission a micro-SaaS",
      description:
        "Prepare a paid request that commissions a deployed, monetized micro-SaaS from a one-sentence " +
        "brief. Returns an unsigned x402 proposal — nothing is paid until PayBox verifies the live " +
        "payment requirements and the user approves. Tell the user `priceUsd` before approving. The " +
        "paid request returns a buildId; follow it with get_build, which is also how to recover the " +
        "result if the response is lost. Do not call this twice for one app: each call is a payment.",
      inputSchema: z
        .object({
          prompt: z
            .string()
            .min(10)
            .max(2000)
            .describe(
              "What the product should be, in plain English. Name the input, what the buyer receives, " +
                "and the price. The app takes one block of pasted text and returns one structured result.",
            ),
          productName: z.string().min(1).max(60).optional().describe("Optional name for the product."),
          priceUsd: z
            .number()
            .min(1)
            .max(100)
            .optional()
            .describe("What a human buyer pays per unit in the generated app. Defaults to 5."),
          maxAmountUsd: z
            .string()
            .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/)
            .optional()
            .describe("Most the user is willing to pay for this build, in USDC. Defaults to 0.50."),
          chain: z.enum(CHAINS).optional().describe("Payment chain. Defaults to eip155:8453 (Base)."),
        })
        .strict(),
      outputSchema: x402OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ prompt, productName, priceUsd, maxAmountUsd, chain }) => {
      try {
        return proposeX402({
          chain: chain ?? "eip155:8453",
          url: `${API_BASE}/api/x402/commission`,
          method: "POST",
          maxAmount: atomicAmount(maxAmountUsd ?? "0.50", USDC_DECIMALS),
          body: {
            prompt,
            ...(productName === undefined ? {} : { productName }),
            ...(priceUsd === undefined ? {} : { priceUsd }),
            // The hosted call must return well inside PayBox's request window,
            // so the endpoint accepts the job and reports progress separately.
            wait: false,
          },
        });
      } catch (error) {
        return failure(error instanceof Error ? error.message : "Could not prepare the paid request.");
      }
    },
  );

  // ── 2. Follow a build ─────────────────────────────────────────────────────
  server.registerTool(
    "get_build",
    {
      title: "Get a build",
      description:
        "Look up a build commissioned through AppFactory: its status, its public URL, the x402 endpoint " +
        "agents can buy from, and its revenue and cost. Read-only and free. Poll this after paying " +
        "rather than commissioning again — a build usually reaches `live` within a minute.",
      inputSchema: z.object({ buildId: buildIdSchema.describe("The build id the paid request returned.") }).strict(),
      outputSchema: buildSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ buildId }) => {
      try {
        const raw = (await readJson(`/api/builds/${encodeURIComponent(buildId)}`)) as Record<string, unknown>;
        const build = buildSchema.parse({
          buildId: raw.buildId,
          status: raw.status,
          productName: raw.productName,
          appUrl: raw.appUrl ?? null,
          agentEndpoint: raw.agentEndpointUrl ?? null,
          humanPriceUsd: raw.humanPriceUsd,
          agentPriceUsd: raw.agentPriceUsd,
          ...(raw.economics ? { economics: raw.economics } : {}),
        });

        const summary =
          build.status === "live"
            ? `${build.productName} is live at ${build.appUrl}. Humans pay $${build.humanPriceUsd.toFixed(2)}; ` +
              `agents pay $${build.agentPriceUsd.toFixed(2)} per call at ${build.agentEndpoint}.`
            : build.status === "failed"
              ? `${build.productName} failed to build. No app was deployed.`
              : `${build.productName} is ${build.status}. Check again shortly.`;

        return textAnd(summary, build);
      } catch (error) {
        return failure(error instanceof Error ? error.message : "Could not read that build.");
      }
    },
  );

  // ── 3. List what has shipped ──────────────────────────────────────────────
  server.registerTool(
    "list_apps",
    {
      title: "List deployed apps",
      description:
        "List micro-SaaS apps AppFactory has deployed, newest first, with their public URLs and both " +
        "prices. Read-only and free.",
      inputSchema: z
        .object({ limit: z.number().int().min(1).max(25).optional().describe("How many to return. Defaults to 10.") })
        .strict(),
      outputSchema: z.object({ count: z.number(), apps: z.array(buildSchema) }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      try {
        const raw = (await readJson(`/api/builds?limit=${limit ?? 10}`)) as { apps?: unknown[] };
        const apps = (raw.apps ?? []).map((a) => buildSchema.parse(a));
        const summary =
          apps.length === 0
            ? "AppFactory has not deployed any apps yet."
            : apps.map((a) => `${a.productName} — ${a.status}${a.appUrl ? ` — ${a.appUrl}` : ""}`).join("\n");
        return textAnd(summary, { count: apps.length, apps });
      } catch (error) {
        return failure(error instanceof Error ? error.message : "Could not list deployed apps.");
      }
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
