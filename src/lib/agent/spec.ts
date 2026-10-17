import { z } from "zod";

/**
 * The agent's output contract.
 *
 * The *structure* of a generated app is templated (that is what makes a live
 * deploy reliable); the *product* is generated. Everything a buyer sees — name,
 * positioning, what the output contains, how it is priced — comes from here.
 */
export const outputFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "must be a camelCase identifier"),
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(160),
  type: z.enum(["score", "text", "list"]),
});

export const productSpecSchema = z.object({
  productName: z.string().min(1).max(60),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase kebab-case"),
  tagline: z.string().min(10).max(140),
  /** What one purchase buys, e.g. "review", "audit", "summary". */
  unit: z.string().min(2).max(24),
  /** Label above the paste box, e.g. "Paste your resume". */
  inputLabel: z.string().min(4).max(80),
  brandColor: z.enum(["indigo", "violet", "blue", "teal", "emerald", "amber", "rose", "slate"]),
  /** The shape of the deliverable the buyer receives. 3–6 fields. */
  outputFields: z.array(outputFieldSchema).min(3).max(6),
  /** Instructions the fulfilment model follows to produce the deliverable. */
  analysisInstructions: z.string().min(40).max(1200),
  /** Plain-English build steps, shown on the timeline. */
  buildSteps: z.array(z.string().min(4).max(120)).min(4).max(12),
});

export type ProductSpec = z.infer<typeof productSpecSchema>;
export type OutputField = z.infer<typeof outputFieldSchema>;

export const BRAND_HEX: Record<ProductSpec["brandColor"], string> = {
  indigo: "#4f46e5",
  violet: "#7c3aed",
  blue: "#2563eb",
  teal: "#0d9488",
  emerald: "#059669",
  amber: "#d97706",
  rose: "#e11d48",
  slate: "#475569",
};

/** A placeholder deliverable, used for `/.well-known/x402` output examples. */
export function sampleOutput(spec: ProductSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.outputFields) {
    if (field.type === "score") out[field.key] = 78;
    else if (field.type === "list") out[field.key] = [`${field.label} item one`, `${field.label} item two`];
    else out[field.key] = `${field.label} appears here.`;
  }
  return out;
}

/** Zod schema matching a spec's declared output, for structured fulfilment. */
export function deliverableSchema(spec: ProductSpec) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of spec.outputFields) {
    if (field.type === "score") shape[field.key] = z.number().min(0).max(100).describe(field.description);
    else if (field.type === "list")
      shape[field.key] = z.array(z.string().min(1).max(400)).min(1).max(8).describe(field.description);
    else shape[field.key] = z.string().min(1).max(2000).describe(field.description);
  }
  return z.object(shape);
}
