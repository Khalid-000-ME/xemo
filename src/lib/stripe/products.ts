import { env } from "@/lib/env";
import { stripe, stripeConfigured } from "./client";

export type ProvisionResult = {
  productId: string | null;
  priceId: string | null;
  simulated: boolean;
  note?: string;
};

/**
 * Create the Stripe product and price that back one generated app.
 *
 * `idempotencyKey` is the build id, so a retried build reuses the same Stripe
 * objects instead of littering the account with duplicates.
 */
export async function provisionProduct(args: {
  buildId: string;
  productName: string;
  tagline: string;
  priceUsd: number;
  appUrl?: string | null;
}): Promise<ProvisionResult> {
  if (!stripeConfigured()) {
    return {
      productId: null,
      priceId: null,
      simulated: true,
      note: "STRIPE_SECRET_KEY not set — product and price were not created",
    };
  }

  const sdk = stripe();

  const product = await sdk.products.create(
    {
      name: args.productName,
      description: args.tagline.slice(0, 350),
      ...(args.appUrl ? { url: args.appUrl } : {}),
      metadata: {
        agentfoundry_build: args.buildId,
        ...(env.stripe.projectId ? { stripe_project: env.stripe.projectId } : {}),
      },
    },
    { idempotencyKey: `af-product-${args.buildId}` },
  );

  const price = await sdk.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(args.priceUsd * 100),
      metadata: { agentfoundry_build: args.buildId },
    },
    { idempotencyKey: `af-price-${args.buildId}` },
  );

  return { productId: product.id, priceId: price.id, simulated: false };
}

export async function createCheckoutSession(args: {
  buildId: string;
  orderId: string;
  priceId: string | null;
  priceUsd: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string | null; simulated: boolean }> {
  if (!stripeConfigured()) {
    // A labelled simulation: the order still completes so the rest of the
    // funnel is demoable, but nothing claims a payment was taken.
    return { url: `${args.successUrl}&simulated=1`, sessionId: null, simulated: true };
  }

  const sdk = stripe();
  const session = await sdk.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        args.priceId
          ? { price: args.priceId, quantity: 1 }
          : {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: Math.round(args.priceUsd * 100),
                product_data: { name: args.productName },
              },
            },
      ],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      client_reference_id: args.orderId,
      metadata: { agentfoundry_build: args.buildId, agentfoundry_order: args.orderId },
      payment_intent_data: {
        metadata: { agentfoundry_build: args.buildId, agentfoundry_order: args.orderId },
      },
    },
    { idempotencyKey: `af-checkout-${args.orderId}` },
  );

  if (!session.url) throw new Error("Stripe returned a session without a checkout URL");
  return { url: session.url, sessionId: session.id, simulated: false };
}
