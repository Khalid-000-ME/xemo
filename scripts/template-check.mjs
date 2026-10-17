#!/usr/bin/env node
/**
 * Template check — runs the generated app's own pipeline, locally.
 *
 * The orchestrator renders this template and then runs `npm install`,
 * `npm run typecheck` and `npm test` inside a CreateOS microVM. That path needs
 * credentials. This script renders the same template with a fixture spec and
 * runs the same three commands here, so a broken template is caught without a
 * sandbox, a model key or a wallet.
 *
 *   npm run template:check
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = join(root, "templates", "analyzer");

// Shaped exactly like a planner result, so the check exercises real values.
const spec = {
  productName: "ReplyRate",
  slug: "replyrate",
  tagline: "Score any cold email's chance of a reply, and get a sharper opening line.",
  unit: "audit",
  inputLabel: "Paste the cold email you want audited",
  brandColor: "indigo",
  outputFields: [
    { key: "replyScore", label: "Reply likelihood", description: "0-100 chance of a reply.", type: "score" },
    { key: "verdict", label: "Verdict", description: "Two sentences on why.", type: "text" },
    { key: "spamTriggers", label: "Spam triggers", description: "Phrases that hurt deliverability.", type: "list" },
    { key: "openingLines", label: "Rewritten openings", description: "Three stronger first lines.", type: "list" },
  ],
};

const BRAND_HEX = { indigo: "#4f46e5" };

const sample = {};
for (const f of spec.outputFields) {
  sample[f.key] = f.type === "score" ? 78 : f.type === "list" ? [`${f.label} one`, `${f.label} two`] : `${f.label} here.`;
}

const vars = {
  PRODUCT_NAME: spec.productName,
  SLUG: spec.slug,
  TAGLINE: spec.tagline,
  UNIT: spec.unit,
  INPUT_LABEL: spec.inputLabel,
  BRAND_HEX: BRAND_HEX[spec.brandColor],
  BUILD_ID: "af_templatecheck",
  PLATFORM_URL: "http://127.0.0.1:3999",
  AGENT_ENDPOINT: "http://127.0.0.1:3999/api/x402/apps/af_templatecheck",
  PRICE_USD: "4.00",
  AGENT_PRICE_USD: "0.02",
  FIELDS_JSON: JSON.stringify(spec.outputFields.map((f) => ({ key: f.key, label: f.label, description: f.description }))),
  SAMPLE_JSON: JSON.stringify(sample),
};

let failed = false;
const fail = (msg) => {
  console.error(`  \u001b[31mFAIL\u001b[0m ${msg}`);
  failed = true;
};
const pass = (msg) => console.log(`  \u001b[32mok\u001b[0m   ${msg}`);

console.log("\n\u001b[1mTemplate check — templates/analyzer\u001b[0m\n");

const workDir = mkdtempSync(join(tmpdir(), "xemo-template-"));
mkdirSync(workDir, { recursive: true });

const names = readdirSync(templateDir).sort();
if (names.length === 0) fail("template directory is empty");

for (const name of names) {
  const raw = readFileSync(join(templateDir, name), "utf8");
  const rendered = raw.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) => (vars[key] === undefined ? m : vars[key]));

  const leftover = [...new Set(rendered.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])];
  if (leftover.length > 0) fail(`${name} has unrendered placeholders: ${leftover.join(", ")}`);
  else pass(`${name} rendered fully (${(Buffer.byteLength(rendered) / 1024).toFixed(1)} kB)`);

  writeFileSync(join(workDir, name), rendered, "utf8");
}

// The same three commands the orchestrator runs in the sandbox.
const steps = [
  { label: "npm install", cmd: "npm", args: ["install", "--no-audit", "--no-fund"] },
  { label: "npm run typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { label: "npm test", cmd: "npm", args: ["test"] },
];

for (const step of steps) {
  const res = spawnSync(step.cmd, step.args, { cwd: workDir, encoding: "utf8", env: { ...process.env, CI: "1" } });
  if (res.status === 0) {
    pass(step.label);
  } else {
    fail(`${step.label} exited ${res.status}`);
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    if (out) console.error(out.split("\n").slice(-25).map((l) => `       ${l}`).join("\n"));
  }
}

console.log(`\nworkspace: ${workDir}`);
console.log(failed ? "\n\u001b[31mtemplate check failed\u001b[0m\n" : "\n\u001b[32mtemplate check passed\u001b[0m\n");
process.exit(failed ? 1 : 0);
