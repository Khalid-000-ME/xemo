import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { env } from "@/lib/env";
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

/**
 * Ask the model for a product specification.
 *
 * Falls back to a deterministic spec when no model key is configured, so a
 * build never fails for want of a credential — the caller reports which path
 * was taken.
 */
export async function planProduct(args: {
  brief: string;
  productName?: string;
  priceUsd?: number;
}): Promise<{ spec: ProductSpec; source: "model" | "fallback"; note?: string }> {
  if (!env.anthropicApiKey) {
    return {
      spec: fallbackSpec(args.brief, args.productName),
      source: "fallback",
      note: "ANTHROPIC_API_KEY not set — used a deterministic specification",
    };
  }

  const anthropic = createAnthropic({ apiKey: env.anthropicApiKey });

  try {
    const { object } = await generateObject({
      model: anthropic(env.agentModel),
      schema: productSpecSchema,
      system: SYSTEM,
      prompt: prompt(args.brief, args.productName, args.priceUsd),
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(90_000),
    });
    return { spec: object, source: "model" };
  } catch (err) {
    return {
      spec: fallbackSpec(args.brief, args.productName),
      source: "fallback",
      note: `planner call failed (${err instanceof Error ? err.message : String(err)}) — used a deterministic specification`,
    };
  }
}

function slugify(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length > 0 ? s : "micro-saas";
}

/** Deterministic plan derived from the brief. Never throws. */
export function fallbackSpec(brief: string, productName?: string): ProductSpec {
  const name = (productName ?? firstPhrase(brief) ?? "Draft Review").slice(0, 60);
  return {
    productName: name,
    slug: slugify(name),
    tagline: "Paste your text and get a structured, actionable review in seconds.",
    unit: "review",
    inputLabel: "Paste the text you want reviewed",
    brandColor: "indigo",
    outputFields: [
      { key: "overallScore", label: "Overall score", description: "A 0–100 verdict on the submission.", type: "score" },
      { key: "summary", label: "Summary", description: "Two sentences on the overall impression.", type: "text" },
      { key: "strengths", label: "Strengths", description: "What already works well.", type: "list" },
      { key: "improvements", label: "Improvements", description: "Specific, actionable changes to make.", type: "list" },
    ],
    analysisInstructions: `Review the submitted text against the brief: "${brief.slice(0, 400)}".
Score it 0–100 in overallScore, being honest rather than generous. Write summary
as two sentences naming the single biggest strength and the single biggest
weakness. List concrete strengths in strengths. In improvements, give specific
rewrites or additions — never vague advice like "add more detail".`,
    buildSteps: [
      "Generate the storefront and its branded landing page",
      "Wire the Stripe Checkout route for human buyers",
      "Expose an x402-gated endpoint so agents can buy the same service",
      "Publish machine-readable terms at /.well-known/x402",
      "Install dependencies and syntax-check every generated file",
      "Run the smoke test against a real server boot",
      "Publish to a public CreateOS URL",
    ],
  };
}

function firstPhrase(brief: string): string | undefined {
  const match = /(?:build|create|make)\s+(?:a|an|the)?\s*([a-z0-9 ]{3,40})/i.exec(brief);
  if (!match) return undefined;
  return match[1]
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
