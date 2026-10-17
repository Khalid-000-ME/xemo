#!/usr/bin/env node
/**
 * CreateOS preflight.
 *
 * Proves the whole sandbox leg works against the real API before a build
 * depends on it: create a microVM with ingress, upload the rendered template,
 * run the same three build steps the orchestrator runs, start the server, and
 * fetch the public URL from outside. Always destroys the sandbox, so it does
 * not leave a slot consumed on a plan with a low concurrency cap.
 *
 *   npm run createos:check
 */
import { createClient } from "@nodeops-createos/sandbox";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.CREATEOS_SANDBOX_API_KEY ?? process.env.CREATEOS_API_KEY;
if (!KEY) {
  console.error("\nCREATEOS_SANDBOX_API_KEY is not set. Load your env first:\n  set -a && source .env.local && set +a && npm run createos:check\n");
  process.exit(1);
}
const APP_DIR = "/root/app";
const PORT = 8080;
const templateDir = join(process.cwd(), "templates", "analyzer");

const spec = {
  PRODUCT_NAME: "ReplyRate", SLUG: "replyrate",
  TAGLINE: "Score any cold email's chance of a reply.",
  UNIT: "audit", INPUT_LABEL: "Paste the cold email",
  BRAND_HEX: "#4f46e5", BUILD_ID: "af_e2echeck",
  PLATFORM_URL: "http://127.0.0.1:3000",
  AGENT_ENDPOINT: "http://127.0.0.1:3000/api/x402/apps/af_e2echeck",
  PRICE_USD: "4.00", AGENT_PRICE_USD: "0.02",
  FIELDS_JSON: JSON.stringify([{ key: "replyScore", label: "Reply likelihood", description: "0-100." }]),
  SAMPLE_JSON: JSON.stringify({ replyScore: 78 }),
};

const client = createClient({ apiKey: KEY });
const t0 = Date.now();
let sandbox;

try {
  console.log("creating sandbox (shape s-1vcpu-1gb, rootfs devbox:1, ingress on)…");
  sandbox = await client.createSandbox({
    shape: "s-1vcpu-1gb",
    rootfs: "devbox:1",
    name: "agentfoundry-e2echeck",
    ingress_enabled: true,
    egress: ["registry.npmjs.org:443", "*.npmjs.org:443", "api.stripe.com:443", "x402.org:443"],
    envs: { BUILD_ID: "af_e2echeck", PORT: String(PORT) },
    auto_pause_after_seconds: 300,
  });
  console.log(`  id=${sandbox.id} status=${sandbox.status} (+${Date.now() - t0}ms)`);

  await sandbox.waitUntilRunning({ timeoutMs: 120_000 });
  console.log(`  running (+${Date.now() - t0}ms)`);

  const node = await sandbox.sh("node -v && npm -v");
  console.log("  toolchain:", node.result.stdout.trim().replace(/\n/g, " / "), "exit", node.result.exit_code);

  await sandbox.sh(`mkdir -p ${APP_DIR}`);
  for (const name of readdirSync(templateDir).sort()) {
    const raw = readFileSync(join(templateDir, name), "utf8");
    const rendered = raw.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (spec[k] === undefined ? m : spec[k]));
    await sandbox.files.upload(`${APP_DIR}/${name}`, rendered);
    console.log(`  uploaded ${name}`);
  }

  for (const [label, script] of [
    ["npm install", "npm install --no-audit --no-fund 2>&1"],
    ["npm run typecheck", "npm run typecheck"],
    ["npm test", "npm test"],
  ]) {
    // `sh` has no cwd option; cd inside the script.
    const r = await sandbox.sh(`cd ${APP_DIR} || exit 1\n${script}`);
    console.log(`  ${label}: exit ${r.result.exit_code} in ${r.exec_ms}ms`);
    if (r.result.exit_code !== 0) {
      console.log((r.result.stdout + r.result.stderr).split("\n").slice(-15).join("\n"));
      throw new Error(`${label} failed`);
    }
    if (label === "npm test") console.log(r.result.stdout.split("\n").filter((l) => l.includes("passed")).join("\n"));
  }

  await sandbox.processes.create({ cmd: "node", args: ["server.mjs"], cwd: APP_DIR, env: { PORT: String(PORT) } });
  await sandbox.waitForPortReady(PORT, { timeoutMs: 90_000, intervalMs: 500 });
  console.log(`  port ${PORT} ready (+${Date.now() - t0}ms)`);

  for (const scheme of ["https", "http"]) {
    const url = sandbox.previewUrl(PORT, { scheme });
    try {
      const res = await fetch(`${url}/_af/health`, { signal: AbortSignal.timeout(8000) });
      console.log(`  ${scheme.toUpperCase()} ${url} -> ${res.status} ${res.ok ? (await res.text()).trim() : ""}`);
      if (res.ok) {
        const home = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const html = await home.text();
        console.log(`  landing page: ${home.status}, ${html.length} bytes, names product: ${html.includes("ReplyRate")}`);
        break;
      }
    } catch (e) {
      console.log(`  ${scheme.toUpperCase()} ${url} -> ${e.message}`);
    }
  }

  console.log(`\nTOTAL ${Math.round((Date.now() - t0) / 1000)}s`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  if (sandbox) {
    await sandbox.destroy().then(() => console.log("sandbox destroyed")).catch((e) => console.error("destroy failed:", e.message));
  }
}
