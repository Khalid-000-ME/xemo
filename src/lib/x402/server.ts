import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import type { Network } from "@x402/core/types";
import { env } from "@/lib/env";

/**
 * The x402 resource server AgentFoundry sells through.
 *
 * There is exactly one of these: the platform is merchant of record for itself
 * and for every app it generates, which keeps real payment verification in one
 * typed place and lets generated apps stay dependency-free.
 *
 * Registering the bazaar extension is what makes a resource discoverable — a
 * service enters the x402 Bazaar by settling a payment through a facilitator
 * that indexes bazaar metadata, not by submitting a listing anywhere.
 */
const globalForX402 = globalThis as unknown as {
  __afX402?: x402ResourceServer;
  __afSupport?: Promise<SupportCheck>;
};

/**
 * Facilitators are not interchangeable.
 *
 * The public x402.org facilitator is **testnet only** — it serves Base Sepolia
 * but not Base mainnet. Mainnet settlement needs a credentialed facilitator,
 * and Coinbase's CDP is the one with fee-free USDC on Base. So CDP credentials,
 * when present, select both the facilitator and its auth.
 */
function facilitatorConfig() {
  if (env.x402.cdpApiKeyId && env.x402.cdpApiKeySecret) {
    return {
      ...createFacilitatorConfig(env.x402.cdpApiKeyId, env.x402.cdpApiKeySecret),
      // Well under the 90s default: a paid endpoint that hangs is worse than
      // one that fails, because the caller cannot tell the two apart.
      timeoutMs: 20_000,
    };
  }
  return { url: env.x402.facilitatorUrl, timeoutMs: 20_000 };
}

export const usingCdpFacilitator = () =>
  Boolean(env.x402.cdpApiKeyId && env.x402.cdpApiKeySecret);

export function facilitatorLabel(): string {
  return usingCdpFacilitator() ? "Coinbase CDP" : env.x402.facilitatorUrl;
}

export function resourceServer(): x402ResourceServer {
  if (globalForX402.__afX402) return globalForX402.__afX402;

  const facilitator = new HTTPFacilitatorClient(facilitatorConfig());
  const server = new x402ResourceServer(facilitator)
    .register(env.x402.network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  globalForX402.__afX402 = server;
  return server;
}

export type SupportCheck = { ok: boolean; message: string; networks?: string[] };

/**
 * Make the resource server ready, and say precisely why if it cannot be.
 *
 * The server needs `initialize()` to fetch the facilitator's supported kinds
 * before it can build payment requirements. That sync is deliberately *not*
 * run at startup, because on a network the facilitator does not support it
 * throws `RouteConfigurationError` and takes the whole process down — a
 * payments misconfiguration should cost one endpoint, not the platform.
 *
 * So it runs here instead, lazily and once. On failure the facilitator's
 * `/supported` is read directly to turn "not supported" into a message naming
 * the variable to change.
 */
export async function facilitatorSupport(): Promise<SupportCheck> {
  globalForX402.__afSupport ??= initializeOnce().catch((err) => {
    // Never cache a failure: a facilitator outage should not disable the
    // endpoint for the life of the process.
    globalForX402.__afSupport = undefined;
    throw err;
  });

  try {
    return await globalForX402.__afSupport;
  } catch (err) {
    const detail = await checkSupport().catch(() => null);
    if (detail && !detail.ok) return detail;
    return {
      ok: false,
      message: `The x402 facilitator (${facilitatorLabel()}) is not usable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

async function initializeOnce(): Promise<SupportCheck> {
  await resourceServer().initialize();
  return { ok: true, message: `${facilitatorLabel()} settles "exact" on ${env.x402.network}.` };
}

async function checkSupport(): Promise<SupportCheck> {
  const config = facilitatorConfig();
  const base = ("url" in config && config.url ? config.url : env.x402.facilitatorUrl).replace(/\/+$/, "");
  const url = `${base}/supported`;

  const headers: Record<string, string> = { accept: "application/json" };
  if ("createAuthHeaders" in config && config.createAuthHeaders) {
    const auth = await config.createAuthHeaders();
    Object.assign(headers, auth.supported ?? {});
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    return { ok: false, message: `Facilitator ${facilitatorLabel()} answered ${res.status} for /supported.` };
  }

  const body = (await res.json()) as { kinds?: Array<{ scheme?: string; network?: string }> };
  const kinds = body.kinds ?? [];
  const networks = [...new Set(kinds.map((k) => k.network).filter((n): n is string => Boolean(n)))];
  const supported = kinds.some((k) => k.scheme === "exact" && k.network === env.x402.network);

  if (supported) {
    return { ok: true, message: `${facilitatorLabel()} settles "exact" on ${env.x402.network}.`, networks };
  }

  const hint = env.x402.network.startsWith("eip155:8453")
    ? " Base mainnet needs a credentialed facilitator: set CDP_API_KEY_ID and CDP_API_KEY_SECRET."
    : "";

  return {
    ok: false,
    message:
      `The facilitator (${facilitatorLabel()}) cannot settle scheme "exact" on X402_NETWORK ` +
      `"${env.x402.network}". It supports: ${networks.join(", ") || "nothing reported"}.${hint}`,
    networks,
  };
}

export const x402Configured = () => Boolean(env.x402.payTo);

/** The address payments settle to. Throws rather than silently selling for free. */
export function payTo(): string {
  if (!env.x402.payTo) {
    throw new Error("X402_PAY_TO is not set — refusing to advertise a priced resource with no payee");
  }
  return env.x402.payTo;
}

export function priceString(usd: number): `$${string}` {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

export function accepts(usd: number) {
  return [
    {
      scheme: "exact" as const,
      price: priceString(usd),
      network: env.x402.network as Network,
      payTo: payTo(),
    },
  ];
}
