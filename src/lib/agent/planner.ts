import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { env, requireModel } from "@/lib/env";
import { inferenceCostUsd } from "@/lib/pricing";
import { type ProductSpec, productSpecSchema } from "./spec";

const SYSTEM = `You are AgentFoundry's planner. You turn a product brief into the
specification for one small, paid web product that will be generated, tested and
deployed automatically.

Hard constraints on what you may specify:
- The product takes ONE block of pasted text as its input and returns ONE
  structured deliverable. Nothing else. No accounts, no uploads, no multi-step
  flows, no integrations you were not given.
- The deliverable has 3 to 6 fields. Prefer exactly one "score" field when a
  numeric verdict makes sense, then a mix of "text" and "list".
- analysisInstructions is the prompt a downstream model will follow to produce
  the deliverable. Write it as direct instructions, name every output field, and
  say what makes the output good. Be specific to this product, not generic.
- buildSteps are the plain-English steps shown on a live build timeline. Make
  them concrete and specific to this product.
- productName is a real product name, not a description. slug is its
  kebab-case form.

Write like a product you would actually pay for: specific, confident, no filler.`;

function prompt(brief: string, requestedName?: string, priceUsd?: number): string {
  const lines = [`Product brief:\n${brief}`];
  if (requestedName) lines.push(`The operator wants the product called "${requestedName}". Use that name.`);
  if (priceUsd) lines.push(`A human buyer pays $${priceUsd.toFixed(2)} per unit. Pitch at that price point.`);
  return lines.join("\n\n");
}

export type PlanResult = {
  spec: ProductSpec;
  /** Measured from the token usage the provider reported, not estimated. */
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Ask the model for a product specification.
 *
 * Throws when no model credential is present. There is no deterministic
 * fallback: a plan nobody's model produced is not a plan worth deploying.
 */
export async function planProduct(args: {
  brief: string;
  productName?: string;
  priceUsd?: number;
}): Promise<PlanResult> {
  requireModel();

  const anthropic = createAnthropic({ apiKey: env.anthropicApiKey });

  const { object, usage } = await generateObject({
    model: anthropic(env.agentModel),
    schema: productSpecSchema,
    system: SYSTEM,
    prompt: prompt(args.brief, args.productName, args.priceUsd),
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(120_000),
  });

  return {
    spec: object,
    costUsd: inferenceCostUsd(env.agentModel, usage),
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}
