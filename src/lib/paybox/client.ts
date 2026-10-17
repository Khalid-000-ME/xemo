import { env, requirePaybox } from "@/lib/env";

/**
 * PayBox client for the **outbound** leg: AgentFoundry buying from other paid
 * services over x402.
 *
 * PayBox is non-custodial and tool-shaped — every operation is an MCP call on
 * `/mcp` authenticated with a `pbx_live_*` bearer, and anything that spends
 * resolves asynchronously through a request that may need passkey approval.
 * So this client does three things: call a tool, poll the request to a terminal
 * state, and surface what actually happened.
 */

type McpContent = { type: string; text?: string };

type McpToolResult = {
  result?: { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
};

export type PayboxRequest = {
  request_id?: string;
  status?: string;
  output?: { value?: Record<string, unknown> };
  [k: string]: unknown;
};

export class PayboxError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

let seq = 0;

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  requirePaybox();

  const res = await fetch(`${env.paybox.apiUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.paybox.apiKey}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++seq,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  if (!res.ok) throw new PayboxError(`PayBox responded ${res.status}`, text.slice(0, 500));

  let body: McpToolResult;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PayboxError("PayBox returned a non-JSON response", text.slice(0, 500));
  }

  if (body.error) throw new PayboxError(`PayBox tool error: ${body.error.message}`, body.error);

  // PayBox returns the payload as structuredContent where available, and as a
  // JSON text block otherwise.
  if (body.result?.structuredContent !== undefined) return body.result.structuredContent;

  const textBlock = body.result?.content?.find((c) => c.type === "text")?.text;
  if (!textBlock) throw new PayboxError("PayBox returned an empty tool result", body);

  try {
    return JSON.parse(textBlock);
  } catch {
    return { text: textBlock };
  }
}

const TERMINAL = new Set(["success", "error", "denied", "failed", "cancelled", "canceled"]);

/** Poll a PayBox request until it reaches a terminal state. */
async function waitForRequest(requestId: string, timeoutMs: number): Promise<PayboxRequest> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1200;

  while (Date.now() < deadline) {
    const req = (await callTool("get_request", { request_id: requestId })) as PayboxRequest;
    const status = String(req.status ?? "").toLowerCase();
    if (TERMINAL.has(status)) return req;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 5000);
  }

  throw new PayboxError(
    `PayBox request ${requestId} did not reach a terminal state within ${Math.round(timeoutMs / 1000)}s. ` +
      `If the credential's approval mode is not autonomous it is waiting on a passkey.`,
  );
}

export type ServiceListing = {
  resource?: string;
  description?: string;
  accepts?: unknown;
  [k: string]: unknown;
};

/** Search the curated x402 Bazaar. Read-only; spends nothing. */
export async function discoverServices(query: string): Promise<ServiceListing[]> {
  const out = (await callTool("discover_services", { query })) as
    | { items?: ServiceListing[]; services?: ServiceListing[] }
    | ServiceListing[];

  if (Array.isArray(out)) return out;
  return out.items ?? out.services ?? [];
}

export type UseServiceResult = {
  requestId: string;
  status: string;
  /** What the paid resource returned. */
  resource: Record<string, unknown> | null;
  /** The payment PayBox settled, including its dollar amount where reported. */
  payment: Record<string, unknown> | null;
  amountUsd: number | null;
};

/**
 * Buy a paid x402 resource through PayBox gateway mode: PayBox handles the 402
 * probe, the signing step and the paid re-fetch.
 *
 * Enforces the per-build spend cap before spending, not after.
 */
export async function useService(args: {
  url: string;
  method?: string;
  body?: unknown;
  maxSpendUsd?: number;
  timeoutMs?: number;
}): Promise<UseServiceResult> {
  requirePaybox();

  const cap = args.maxSpendUsd ?? env.paybox.maxSpendPerBuildUsd;

  const started = (await callTool("use_service", {
    credential_id: env.paybox.credentialId,
    url: args.url,
    method: args.method ?? "POST",
    ...(args.body === undefined ? {} : { body: args.body }),
  })) as PayboxRequest;

  const requestId = String(started.request_id ?? "");
  if (!requestId) throw new PayboxError("PayBox did not return a request id", started);

  const quoted = quotedAmountUsd(started);
  if (quoted !== null && quoted > cap) {
    throw new PayboxError(
      `PayBox quoted $${quoted.toFixed(4)} for ${args.url}, above the $${cap.toFixed(2)} per-build cap. ` +
        `Raise PAYBOX_MAX_SPEND_PER_BUILD_USD to allow it.`,
    );
  }

  const settled = TERMINAL.has(String(started.status ?? "").toLowerCase())
    ? started
    : await waitForRequest(requestId, args.timeoutMs ?? 180_000);

  const value = settled.output?.value ?? {};
  const payment = (value.payment as Record<string, unknown> | undefined) ?? null;
  const resource = (value.resource as Record<string, unknown> | undefined) ?? null;
  const status = String(settled.status ?? "unknown");

  // Partial success is a real outcome: the payment can settle while the fetch
  // fails, so report both rather than collapsing them into one verdict.
  if (status.toLowerCase() !== "success") {
    throw new PayboxError(`PayBox request ${requestId} ended as ${status}`, { payment, resource });
  }

  return {
    requestId,
    status,
    resource,
    payment,
    amountUsd: quotedAmountUsd(settled) ?? quoted,
  };
}

/**
 * PayBox reports the dollar amount already converted in `plan.x402.amount_usd`.
 * It must be read, never derived from the atomic amount.
 */
function quotedAmountUsd(req: PayboxRequest): number | null {
  const plan = req.plan as { x402?: { amount_usd?: unknown } } | undefined;
  const raw = plan?.x402?.amount_usd;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function whoami(): Promise<unknown> {
  return callTool("list_credentials", {});
}

export const payboxConfigured = () => Boolean(env.paybox.apiKey && env.paybox.credentialId);
