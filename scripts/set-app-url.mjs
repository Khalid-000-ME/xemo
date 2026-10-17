#!/usr/bin/env node
/**
 * Repoint the platform at a new public origin.
 *
 * A quick tunnel hands out a different hostname every restart, and the origin
 * appears in four places that must agree: the advertised x402 resource URL, the
 * sandbox egress allowlist, the callbacks baked into generated apps, and the
 * plugin's XEMO_API_URL in the PayBox portal. This updates the first
 * three and prints what to change in the fourth.
 *
 *   node scripts/set-app-url.mjs https://something.trycloudflare.com
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = process.argv[2];
if (!raw) {
  console.error("\nUsage: node scripts/set-app-url.mjs https://your-public-origin\n");
  process.exit(1);
}

let origin;
try {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("must be https");
  origin = url.origin;
} catch (err) {
  console.error(`\n"${raw}" is not a usable public origin: ${err.message}`);
  console.error("x402 payment requirements must be served over HTTPS.\n");
  process.exit(1);
}

const path = resolve(process.cwd(), ".env.local");
let env;
try {
  env = readFileSync(path, "utf8");
} catch {
  console.error(`\nNo .env.local at ${path}\n`);
  process.exit(1);
}

const line = `NEXT_PUBLIC_APP_URL=${origin}`;
const updated = /^NEXT_PUBLIC_APP_URL=.*$/m.test(env)
  ? env.replace(/^NEXT_PUBLIC_APP_URL=.*$/gm, line)
  : `${env.trimEnd()}\n${line}\n`;

// Collapse any duplicates a previous hand-edit left behind: the loader takes
// the last one, so two entries make the active value hard to see.
const seen = [];
const deduped = updated
  .split("\n")
  .filter((l) => {
    if (!l.startsWith("NEXT_PUBLIC_APP_URL=")) return true;
    if (seen.length) return false;
    seen.push(l);
    return true;
  })
  .join("\n");

writeFileSync(path, deduped);

const host = new URL(origin).hostname;
console.log(`\n  .env.local  NEXT_PUBLIC_APP_URL -> ${origin}\n`);
console.log("  Next:");
console.log("    pnpm build && pnpm start");
console.log(`    BASE=${origin} pnpm smoke\n`);
console.log("  Then in the PayBox portal (Test & configure):");
console.log(`    Variables      XEMO_API_URL = ${origin}`);
console.log(`    Network access ${host}\n`);
console.log("  Apps deployed under the previous origin keep calling it, so their");
console.log("  checkout will fail. Rebuild anything you plan to demo.\n");
