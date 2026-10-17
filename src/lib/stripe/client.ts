import Stripe from "stripe";
import { env } from "@/lib/env";

let cached: Stripe | undefined;

export function stripe(): Stripe {
  if (!env.stripe.secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
  cached ??= new Stripe(env.stripe.secretKey, {
    appInfo: { name: "AgentFoundry", url: env.appUrl },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return cached;
}

export const stripeConfigured = () => Boolean(env.stripe.secretKey);
