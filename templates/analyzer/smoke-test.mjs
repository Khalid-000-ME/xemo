/**
 * Smoke test for {{PRODUCT_NAME}} (build {{BUILD_ID}}).
 *
 * Boots the real server on an ephemeral port and asserts the routes a buyer
 * actually hits. Runs inside the CreateOS sandbox before the app is published,
 * so a broken build never gets a public URL.
 */

import { spawn } from "node:child_process";

const PORT = Number(process.env.SMOKE_PORT || 8099);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForBoot(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
      last = `status ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server never became healthy: ${last}`);
}

const child = spawn("node", ["server.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

try {
  console.log(`\n{{PRODUCT_NAME}} — smoke test\n`);
  await waitForBoot();

  const health = await fetch(`${BASE}/healthz`);
  const healthBody = await health.json();
  check("GET /healthz returns 200", health.status === 200, `got ${health.status}`);
  check("health payload names the build", healthBody.buildId === "{{BUILD_ID}}", `got ${healthBody.buildId}`);

  const home = await fetch(`${BASE}/`);
  const homeHtml = await home.text();
  check("GET / returns 200", home.status === 200, `got ${home.status}`);
  check("landing page renders the product name", homeHtml.includes("{{PRODUCT_NAME}}"));
  check("landing page shows the human price", homeHtml.includes("{{PRICE_USD}}"));
  check("landing page offers the agent rail", homeHtml.toLowerCase().includes("x402"));
  check("landing page declares a viewport", homeHtml.includes("width=device-width"));

  const terms = await fetch(`${BASE}/.well-known/x402`);
  const termsBody = await terms.json();
  check("GET /.well-known/x402 returns 200", terms.status === 200, `got ${terms.status}`);
  check("terms advertise a paid resource", typeof termsBody.resource === "string" && termsBody.resource.length > 0);
  check("terms advertise an agent price", Number(termsBody.priceUsd) > 0, `got ${termsBody.priceUsd}`);

  const unpaid = await fetch(`${BASE}/api/agent/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "x".repeat(50) }),
  });
  check("unpaid agent call answers 402", unpaid.status === 402, `got ${unpaid.status}`);

  const short = await fetch(`${BASE}/api/order`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "too short" }),
  });
  check("order rejects input under the minimum", short.status === 400, `got ${short.status}`);

  const missing = await fetch(`${BASE}/nope`);
  check("unknown route returns 404", missing.status === 404, `got ${missing.status}`);

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
    if (serverLog.trim()) console.error(`\nServer output:\n${serverLog.trim()}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`\nsmoke test could not run: ${err.message}`);
  if (serverLog.trim()) console.error(`\nServer output:\n${serverLog.trim()}`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
