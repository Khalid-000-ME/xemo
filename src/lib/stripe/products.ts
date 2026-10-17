import { env, requireStripe } from "@/lib/env";
import { stripe } from "./client";

export type ProvisionResult = {
  productId: string;
  priceId: string;
};

/**
 * Create the Stripe product and price that back one generated app.
 *
 * Idempotency keys are derived from the build id, so a retried build reuses the
 * same Stripe objects instead of littering the account with duplicates.
 */
export async function provisionProduct(args: {
  buildId: string;
  productName: string;
  tagline: string;
  priceUsd: number;
  appUrl: string;
}): Promise<ProvisionResult> {
  requireStripe();
  const sdk = stripe();

  const product = await sdk.products.create(
    {
      name: args.productName,
      description: args.tagline.slice(0, 350),
      url: args.appUrl,
      metadata: {
        xemo_build: args.buildId,
        ...(env.stripe.projectId ? { stripe_project: env.stripe.projectId } : {}),
      },
    },
    { idempotencyKey: `xm-product-${args.buildId}` },
  );

  const price = await sdk.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(args.priceUsd * 100),
      metadata: { xemo_build: args.buildId },
    },
    { idempotencyKey: `xm-price-${args.buildId}` },
  );

  return { productId: product.id, priceId: price.id };
}

export async function createCheckoutSession(args: {
  buildId: string;
  orderId: string;
  priceId: string | null;
  priceUsd: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  requireStripe();
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
      metadata: { xemo_build: args.buildId, xemo_order: args.orderId },
      payment_intent_data: {
        metadata: { xemo_build: args.buildId, xemo_order: args.orderId },
      },
    },
    { idempotencyKey: `xm-checkout-${args.orderId}` },
  );

  if (!session.url) throw new Error("Stripe returned a session without a checkout URL");
  return { url: session.url, sessionId: session.id };
}
