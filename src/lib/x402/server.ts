import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
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
const globalForX402 = globalThis as unknown as { __afX402?: x402ResourceServer };

export function resourceServer(): x402ResourceServer {
  if (globalForX402.__afX402) return globalForX402.__afX402;

  const facilitator = new HTTPFacilitatorClient({ url: env.x402.facilitatorUrl });
  const server = new x402ResourceServer(facilitator)
    .register(env.x402.network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  globalForX402.__afX402 = server;
  return server;
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
