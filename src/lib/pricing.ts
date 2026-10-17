/**
 * Model pricing, in USD per million tokens.
 *
 * Costs booked into the ledger are computed from the token usage the provider
 * actually reports, never from an estimate. If a model is not in this table the
 * caller must say so rather than guess a price.
 *
 * Only models this account can actually reach are listed. Groq bills reasoning
 * tokens as output, and the SDK already folds them into `outputTokens`, so no
 * separate term is needed here.
 */
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  "openai/gpt-oss-safeguard-20b": { input: 0.075, output: 0.3 },
  "qwen/qwen3.8-27b": { input: 0.8, output: 4.0 },
};

export type TokenUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

export class UnknownModelPriceError extends Error {
  readonly code = "UNKNOWN_MODEL_PRICE";
  constructor(model: string) {
    super(
      `No pricing on record for model "${model}". Add it to src/lib/pricing.ts ` +
        `so inference cost can be booked from real token usage. Known: ${knownModels().join(", ")}.`,
    );
  }
}

/** Cost of one inference call, from the usage the provider reported. */
export function inferenceCostUsd(model: string, usage: TokenUsage): number {
  const rate = USD_PER_MTOK[model];
  if (!rate) throw new UnknownModelPriceError(model);

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cost = (input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output;
  return Math.round(cost * 1e6) / 1e6;
}

export function knownModels(): string[] {
  return Object.keys(USD_PER_MTOK);
}

export const isPriced = (model: string): boolean => model in USD_PER_MTOK;
