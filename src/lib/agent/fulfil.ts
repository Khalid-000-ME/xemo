import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, orders } from "@/lib/db/schema";
import { env, requireModel } from "@/lib/env";
import { post } from "@/lib/ledger";
import { inferenceCostUsd } from "@/lib/pricing";
import { deliverableSchema, type ProductSpec, productSpecSchema } from "./spec";

export type FulfilResult = {
  result: Record<string, unknown>;
  costUsd: number;
};

function specOf(build: { plan: unknown }): ProductSpec | null {
  const parsed = productSpecSchema.safeParse(build.plan);
  return parsed.success ? parsed.data : null;
}

/**
 * Produce the deliverable a buyer paid for.
 *
 * Shared by both rails: the Stripe webhook calls it after
 * `checkout.session.completed`, and the x402 gateway calls it once a payment is
 * verified. It throws on failure rather than returning placeholder output —
 * the caller answers non-2xx, which is what stops an x402 payment settling.
 */
export async function fulfil(args: {
  buildId: string;
  input: string;
  orderId?: string;
  rail: "human" | "agent";
}): Promise<FulfilResult> {
  requireModel();

  const [build] = await db.select().from(builds).where(eq(builds.id, args.buildId)).limit(1);
  if (!build) throw new Error(`unknown build ${args.buildId}`);

  const spec = specOf(build);
  if (!spec) throw new Error(`build ${args.buildId} has no usable product specification`);

  const anthropic = createAnthropic({ apiKey: env.anthropicApiKey });

  try {
    const { object, usage } = await generateObject({
      model: anthropic(env.agentModel),
      schema: deliverableSchema(spec),
      system: `You are the fulfilment engine for "${spec.productName}" — ${spec.tagline}

${spec.analysisInstructions}

Judge only what you are given. Be specific and concrete; never pad with generic
advice. If the submission is too thin to judge, say so plainly in the text
fields and score it accordingly.`,
      prompt: `Produce the deliverable for this submission:\n\n---\n${args.input.slice(0, 40_000)}\n---`,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(180_000),
    });

    const costUsd = inferenceCostUsd(env.agentModel, usage);

    await post({
      buildId: args.buildId,
      provider: "anthropic",
      rail: "supplier",
      direction: "outflow",
      amountUsd: costUsd,
      purpose: "llm_inference",
      externalId: args.orderId ? `fulfil:${args.orderId}` : null,
      metadata: {
        stage: "fulfilment",
        model: env.agentModel,
        rail: args.rail,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    });

    const result = object as Record<string, unknown>;
    if (args.orderId) {
      await db
        .update(orders)
        .set({ status: "complete", result, updatedAt: new Date() })
        .where(eq(orders.id, args.orderId));
    }
    return { result, costUsd };
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
