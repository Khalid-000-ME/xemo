#!/usr/bin/env node
/**
 * Platform smoke test.
 *
 * Exercises the real surfaces a judge or an agent will touch, against a running
 * instance. Assertions that depend on an unconfigured rail are reported as
 * skipped rather than failed, so a run without credentials still tells you
 * whether the platform itself is sound.
 *
 *   npm run smoke                       # against localhost:3000
 *   BASE=https://your-url npm run smoke
 */

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");

let pass = 0;
const fails = [];
const skips = [];

const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  \u001b[32mok\u001b[0m   ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const skip = (name, why) => {
  skips.push(name);
  console.log(`  \u001b[33mskip\u001b[0m ${name} — ${why}`);
};

const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);

async function get(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

const post = (path, payload, headers = {}) =>
  get(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

console.log(`\nXemo smoke test → ${BASE}`);

// ── Platform reachable ───────────────────────────────────────────────────────
section("Platform");
let caps;
try {
  const probe = await get("/api/capabilities");
  ok("GET /api/capabilities returns 200", probe.res.status === 200, `got ${probe.res.status}`);
  caps = probe.body;
  ok("readiness report lists the rails", Array.isArray(caps?.rails) && caps.rails.length >= 5);
  ok("readiness states whether a build can run", typeof caps?.buildReady === "boolean");
} catch (err) {
  console.error(`\n  cannot reach ${BASE}: ${err.message}\n  Is the server running?\n`);
  process.exit(1);
}

const live = Object.fromEntries((caps.rails ?? []).map((r) => [r.id, r.ready]));
for (const rail of caps.rails ?? []) {
  const mark = rail.ready
    ? "\u001b[32m\u25cf\u001b[0m"
    : rail.blocking
      ? "\u001b[31m\u25cb\u001b[0m"
      : "\u001b[90m\u25cb\u001b[0m";
  const suffix = rail.ready ? rail.detail : `MISSING ${rail.missing.join(", ")}`;
  console.log(`       ${mark} ${rail.label}: ${suffix}`);
}
if (!caps.buildReady) {
  console.log(`       \u001b[31mbuilds are blocked\u001b[0m \u2014 set: ${caps.missing.join(", ")}`);
}

const home = await get("/");
ok("GET / returns 200", home.res.status === 200, `got ${home.res.status}`);
ok("landing page is HTML", typeof home.body === "string" && home.body.includes("<!DOCTYPE html"));

const dash = await get("/dashboard");
ok("GET /dashboard returns 200", dash.res.status === 200, `got ${dash.res.status}`);

// ── MCP server (the PayBox plugin's endpoint) ────────────────────────────────
section("MCP server");
const init = await post("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
ok("initialize returns a protocol version", Boolean(init.body?.result?.protocolVersion), JSON.stringify(init.body)?.slice(0, 120));
ok("initialize names the server", init.body?.result?.serverInfo?.name === "xemo");

const toolList = await post("/api/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
const toolNames = (toolList.body?.result?.tools ?? []).map((t) => t.name);
ok("tools/list advertises quote_app_build", toolNames.includes("quote_app_build"), toolNames.join(","));
ok("every tool declares an input schema", (toolList.body?.result?.tools ?? []).every((t) => t.inputSchema?.type === "object"));

const quote = await post("/api/mcp", {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "quote_app_build", arguments: { prompt: "a paid resume reviewer" } },
});
ok("quote_app_build quotes a price", Number(quote.body?.result?.structuredContent?.priceUsd) > 0);
ok("quote_app_build names the paid resource", String(quote.body?.result?.structuredContent?.resource ?? "").includes("/api/x402/commission"));

const badTool = await post("/api/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } });
ok("unknown tool is a JSON-RPC error", badTool.body?.error?.code === -32602, JSON.stringify(badTool.body)?.slice(0, 100));

const badMethod = await post("/api/mcp", { jsonrpc: "2.0", id: 5, method: "does/not/exist" });
ok("unknown method is method-not-found", badMethod.body?.error?.code === -32601);

// ── x402 rails ───────────────────────────────────────────────────────────────
section("x402 rails");
const unpaid = await post("/api/x402/commission", { prompt: "Build a paid AI resume reviewer" });

if (!live.x402) {
  ok("commission endpoint declines cleanly when unconfigured", unpaid.res.status === 503, `got ${unpaid.res.status}`);
  skip("402 challenge carries payment requirements", "X402_PAY_TO is not set");
  skip("challenge advertises bazaar discovery", "X402_PAY_TO is not set");
} else if (unpaid.body?.error?.code === "FACILITATOR_UNSUPPORTED") {
  // A network the facilitator cannot settle on is a configuration choice, not
  // a defect — but it must be reported precisely and fast, never as a hang.
  ok("facilitator mismatch fails fast with a named cause", unpaid.res.status === 503);
  ok(
    "the failure names the facilitator and the network",
    typeof unpaid.body.error.network === "string" && typeof unpaid.body.error.facilitator === "string",
  );
  skip("402 challenge carries payment requirements", `facilitator cannot settle on ${unpaid.body.error.network}`);
  skip("challenge advertises bazaar discovery", `facilitator cannot settle on ${unpaid.body.error.network}`);
} else {
  ok("unpaid commission answers 402", unpaid.res.status === 402, `got ${unpaid.res.status}`);

  const header = unpaid.res.headers.get("payment-required");
  ok("402 carries a PAYMENT-REQUIRED header", Boolean(header));

  let challenge;
  try {
    challenge = JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8"));
  } catch {
    challenge = null;
  }
  ok("challenge decodes as x402 v2", challenge?.x402Version === 2, `got ${challenge?.x402Version}`);
  const accept = challenge?.accepts?.[0];
  ok("challenge offers an exact-scheme option", accept?.scheme === "exact");
  ok("challenge names a payee", /^0x[a-fA-F0-9]{40}$/.test(accept?.payTo ?? ""), accept?.payTo);
  ok("challenge prices in atomic units", /^\d+$/.test(String(accept?.amount ?? "")), accept?.amount);
  ok("challenge declares the bazaar extension", Boolean(challenge?.extensions?.bazaar));
  ok("bazaar declaration carries an input schema", Boolean(challenge?.extensions?.bazaar?.schema?.properties?.input));
  ok("resource advertises a service name", Boolean(challenge?.resource?.serviceName));
}

// ── Validation and error shapes ──────────────────────────────────────────────
section("Validation");
const noPrompt = await post("/api/agent/create-app", {});
ok("create-app rejects a missing prompt", noPrompt.res.status === 400, `got ${noPrompt.res.status}`);
ok("errors use the structured envelope", Boolean(noPrompt.body?.error?.code));

const shortPrompt = await post("/api/agent/create-app", { prompt: "hi" });
ok("create-app rejects a too-short prompt", shortPrompt.res.status === 400 && shortPrompt.body?.error?.code === "PROMPT_TOO_SHORT", shortPrompt.body?.error?.code);

const badPrice = await post("/api/agent/create-app", { prompt: "Build a paid thing that reviews text", priceUsd: 9999 });
ok("create-app rejects an out-of-range price", badPrice.body?.error?.code === "PRICE_OUT_OF_RANGE", badPrice.body?.error?.code);

const missingBuild = await get("/api/builds/af_does_not_exist");
ok("unknown build returns 404", missingBuild.res.status === 404, `got ${missingBuild.res.status}`);

const missingOrder = await get("/api/orders/or_does_not_exist");
ok("unknown order returns 404", missingOrder.res.status === 404, `got ${missingOrder.res.status}`);

// ── Stripe webhook ───────────────────────────────────────────────────────────
section("Stripe webhook");
const unsigned = await post("/api/stripe/webhook", { type: "checkout.session.completed" });
if (!live.stripe) {
  ok("webhook refuses to trust an unverifiable payload", unsigned.res.status === 503, `got ${unsigned.res.status}`);
} else {
  ok("webhook refuses an unsigned payload", unsigned.res.status === 400, `got ${unsigned.res.status}`);
  ok("refusal names the signature problem", String(unsigned.body?.error?.code ?? "").includes("SIGNATURE"), unsigned.body?.error?.code);
}

// ── No simulated paths ───────────────────────────────────────────────────────
section("No simulated paths");
const startAttempt = await post("/api/agent/create-app", {
  prompt: "Build a paid cold email auditor that charges $4 per audit",
  priceUsd: 4,
});

if (caps.buildReady) {
  ok("a build starts when every rail is ready", startAttempt.res.status === 202, `got ${startAttempt.res.status}`);
  ok("the build gets an id", typeof startAttempt.body?.buildId === "string");
} else {
  ok(
    "a build refuses rather than simulating",
    startAttempt.res.status === 503 && startAttempt.body?.error?.code === "MISSING_CREDENTIALS",
    `got ${startAttempt.res.status} ${startAttempt.body?.error?.code}`,
  );
  ok(
    "the refusal names the missing variables",
    Array.isArray(startAttempt.body?.error?.missing) && startAttempt.body.error.missing.length > 0,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n\u001b[1m${pass} passed, ${fails.length} failed, ${skips.length} skipped\u001b[0m\n`);
if (fails.length > 0) {
  console.error("Failures:");
  for (const f of fails) console.error(`  - ${f}`);
  console.error("");
  process.exit(1);
}
