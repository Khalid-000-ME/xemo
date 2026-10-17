import { z } from "zod";

/**
 * The agent's output contract.
 *
 * The *structure* of a generated app is templated (that is what makes a live
 * deploy reliable); the *product* is generated. Everything a buyer sees — name,
 * positioning, what the output contains, how it is priced — comes from here.
 */
/**
 * Bounds here are generous on purpose.
 *
 * Groq validates the JSON schema server-side and *rejects* a response that
 * overshoots a `maxLength` — a tagline one word too long fails the whole build.
 * Tight limits are a presentation concern, so the schema stays permissive and
 * `normalizeSpec` trims to display lengths afterwards.
 */
export const outputFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "must be a camelCase identifier"),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  type: z.enum(["score", "text", "list"]),
});

export const productSpecSchema = z.object({
  productName: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase kebab-case"),
  tagline: z.string().min(10).max(400),
  /** What one purchase buys, e.g. "review", "audit", "summary". */
  unit: z.string().min(2).max(60),
  /** Label above the paste box, e.g. "Paste your resume". */
  inputLabel: z.string().min(4).max(200),
  brandColor: z.enum(["indigo", "violet", "blue", "teal", "emerald", "amber", "rose", "slate"]),
  /** The shape of the deliverable the buyer receives. 3–6 fields. */
  outputFields: z.array(outputFieldSchema).min(3).max(6),
  /** Instructions the fulfilment model follows to produce the deliverable. */
  analysisInstructions: z.string().min(40).max(4000),
  /** Plain-English build steps, shown on the timeline. */
  buildSteps: z.array(z.string().min(4).max(300)).min(4).max(12),
});

export type ProductSpec = z.infer<typeof productSpecSchema>;
export type OutputField = z.infer<typeof outputFieldSchema>;

/** Trim a generated spec to the lengths the UI and storefront are built for. */
export function normalizeSpec(spec: ProductSpec): ProductSpec {
  const cut = (value: string, max: number) =>
    value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}\u2026`;

  return {
    ...spec,
    productName: cut(spec.productName.trim(), 60),
    slug: spec.slug.slice(0, 40).replace(/-+$/, "") || "micro-saas",
    tagline: cut(spec.tagline.trim(), 160),
    unit: cut(spec.unit.trim(), 24),
    inputLabel: cut(spec.inputLabel.trim(), 80),
    outputFields: spec.outputFields.map((f) => ({
      ...f,
      label: cut(f.label.trim(), 60),
      description: cut(f.description.trim(), 160),
    })),
    buildSteps: spec.buildSteps.map((s) => cut(s.trim(), 120)),
  };
}

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
