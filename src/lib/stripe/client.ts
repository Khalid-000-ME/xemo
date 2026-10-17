import Stripe from "stripe";
import { env, requireStripe } from "@/lib/env";

let cached: Stripe | undefined;

export function stripe(): Stripe {
  requireStripe();
  cached ??= new Stripe(env.stripe.secretKey as string, {
    appInfo: { name: "AgentFoundry", url: env.appUrl },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return cached;
}
