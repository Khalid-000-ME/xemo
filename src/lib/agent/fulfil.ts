import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, orders } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { post } from "@/lib/ledger";
import { deliverableSchema, type ProductSpec, productSpecSchema, sampleOutput } from "./spec";

/** Cost of one fulfilment inference, booked against the build's margin. */
const FULFIL_COST_USD = 0.03;

export type FulfilResult = {
  result: Record<string, unknown>;
  simulated: boolean;
  note?: string;
};

function specOf(build: { plan: unknown }): ProductSpec | null {
  const parsed = productSpecSchema.safeParse(build.plan);
  return parsed.success ? parsed.data : null;
}

/**
 * Produce the deliverable a buyer paid for.
 *
 * Shared by both rails: a Stripe webhook calls it after `checkout.session.completed`,
 * and the x402 route calls it once a payment is verified. When no model key is
 * present it returns the spec's own sample output, clearly marked simulated,
 * rather than failing a paid order.
 */
export async function fulfil(args: {
  buildId: string;
  input: string;
  orderId?: string;
  rail: "human" | "agent";
}): Promise<FulfilResult> {
  const [build] = await db.select().from(builds).where(eq(builds.id, args.buildId)).limit(1);
  if (!build) throw new Error(`unknown build ${args.buildId}`);

  const spec = specOf(build);
  if (!spec) throw new Error(`build ${args.buildId} has no usable product specification`);

  if (!env.anthropicApiKey) {
    const result = sampleOutput(spec);
    if (args.orderId) await completeOrder(args.orderId, result);
    return {
      result,
      simulated: true,
      note: "ANTHROPIC_API_KEY not set — returned the specification's sample output",
    };
  }

  const anthropic = createAnthropic({ apiKey: env.anthropicApiKey });

  try {
    const { object } = await generateObject({
      model: anthropic(env.agentModel),
      schema: deliverableSchema(spec),
      system: `You are the fulfilment engine for "${spec.productName}" — ${spec.tagline}

${spec.analysisInstructions}

Judge only what you are given. Be specific and concrete; never pad with generic
advice. If the submission is too thin to judge, say so plainly in the text
fields and score it accordingly.`,
      prompt: `Produce the deliverable for this submission:\n\n---\n${args.input.slice(0, 40_000)}\n---`,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(120_000),
    });

    await post({
      buildId: args.buildId,
      provider: "paybox",
      rail: "supplier",
      direction: "outflow",
      amountUsd: FULFIL_COST_USD,
      purpose: "llm_inference",
      externalId: args.orderId ? `fulfil:${args.orderId}` : null,
      settled: Boolean(env.paybox.apiKey),
      metadata: { stage: "fulfilment", model: env.agentModel, rail: args.rail },
    });

    const result = object as Record<string, unknown>;
    if (args.orderId) await completeOrder(args.orderId, result);
    return { result, simulated: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.orderId) {
      await db
        .update(orders)
        .set({ status: "failed", result: { error: message }, updatedAt: new Date() })
        .where(eq(orders.id, args.orderId));
    }
    throw new Error(`fulfilment failed: ${message}`);
  }
}

async function completeOrder(orderId: string, result: Record<string, unknown>): Promise<void> {
  await db
    .update(orders)
    .set({ status: "complete", result, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
}
