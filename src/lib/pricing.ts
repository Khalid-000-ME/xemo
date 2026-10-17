/**
 * Model pricing, in USD per million tokens.
 *
 * Costs booked into the ledger are computed from the token usage the provider
 * actually reports, never from an estimate. If a model is not in this table the
 * caller must say so rather than guess a price.
 */
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export type TokenUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(
      `No pricing on record for model "${model}". Add it to src/lib/pricing.ts ` +
        `so inference cost can be booked from real token usage.`,
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
