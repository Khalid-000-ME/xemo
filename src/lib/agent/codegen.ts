import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BRAND_HEX, type ProductSpec, sampleOutput } from "./spec";

export type GeneratedFile = {
  path: string;
  content: string;
  language: string;
};

const TEMPLATE_ROOT = resolve(process.cwd(), "templates");

/**
 * Template + substitution.
 *
 * A live demo cannot afford a model writing a whole application from scratch,
 * so the skeleton is fixed and reviewed, and every product-specific value is
 * substituted from the generated spec. `assertFullyRendered` guarantees no
 * placeholder survives into a deployed app.
 */
export async function generateApp(args: {
  spec: ProductSpec;
  buildId: string;
  platformUrl: string;
  agentEndpoint: string;
  humanPriceUsd: number;
  agentPriceUsd: number;
  template?: string;
}): Promise<GeneratedFile[]> {
  const templateDir = join(TEMPLATE_ROOT, args.template ?? "analyzer");
  const names = await readdir(templateDir);

  const vars: Record<string, string> = {
    PRODUCT_NAME: args.spec.productName,
    SLUG: args.spec.slug,
    TAGLINE: args.spec.tagline,
    UNIT: args.spec.unit,
    INPUT_LABEL: args.spec.inputLabel,
    BRAND_HEX: BRAND_HEX[args.spec.brandColor],
    BUILD_ID: args.buildId,
    PLATFORM_URL: args.platformUrl,
    AGENT_ENDPOINT: args.agentEndpoint,
    PRICE_USD: args.humanPriceUsd.toFixed(2),
    AGENT_PRICE_USD: args.agentPriceUsd.toFixed(2),
    FIELDS_JSON: JSON.stringify(
      args.spec.outputFields.map((f) => ({ key: f.key, label: f.label, description: f.description })),
    ),
    SAMPLE_JSON: JSON.stringify(sampleOutput(args.spec)),
  };

  const files: GeneratedFile[] = [];
  for (const name of names.sort()) {
    const raw = await readFile(join(templateDir, name), "utf8");
    const content = substitute(raw, vars);
    assertFullyRendered(name, content);
    files.push({ path: name, content, language: languageOf(name) });
  }
  return files;
}

function substitute(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    return value;
  });
}

/** A surviving `{{PLACEHOLDER}}` means a broken app; fail loudly, not silently. */
function assertFullyRendered(path: string, content: string): void {
  const leftover = content.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (leftover) {
    throw new Error(`template ${path} still contains unrendered placeholders: ${[...new Set(leftover)].join(", ")}`);
  }
}

function languageOf(path: string): string {
  if (path.endsWith(".mjs") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "text";
}

export async function listTemplates(): Promise<string[]> {
  try {
    const entries = await readdir(TEMPLATE_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return ["analyzer"];
  }
}
