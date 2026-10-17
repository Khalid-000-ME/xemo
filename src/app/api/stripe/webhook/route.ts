import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";
import { fulfil } from "@/lib/agent/fulfil";
import { post } from "@/lib/ledger";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Stripe webhook.
 *
 * Verified against the raw body, never the parsed one. Idempotency lives in the
 * ledger, which is keyed on (provider, externalId), so a replayed event posts
 * no second row and re-fulfils nothing.
 */
export async function POST(req: Request) {
  if (!env.stripe.secretKey || !env.stripe.webhookSecret) {
    return fail(
      503,
      "STRIPE_NOT_CONFIGURED",
      "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are both required; refusing to trust an unverifiable payload",
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return fail(400, "SIGNATURE_MISSING", "stripe-signature header is required");

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, env.stripe.webhookSecret);
  } catch (err) {
    return fail(400, "SIGNATURE_INVALID", err instanceof Error ? err.message : "could not verify the signature");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCompleted(event);
        break;
      case "checkout.session.expired":
      case "payment_intent.payment_failed":
        await onAbandoned(event);
        break;
      default:
        break;
    }
  } catch (err) {
    // Returning 500 asks Stripe to retry, which is correct for a transient
    // fulfilment failure and harmless for a permanent one thanks to the
    // idempotent ledger.
    return fail(500, "HANDLER_FAILED", err instanceof Error ? err.message : "handler failed");
  }

  return ok({ received: true, type: event.type });
}

async function onCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.agentfoundry_order ?? session.client_reference_id ?? undefined;
  if (!orderId) return;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;

  const amountUsd = (session.amount_total ?? 0) / 100;

  // Idempotent: a replay returns null here and we stop before re-fulfilling.
  const posted = await post({
    buildId: order.buildId,
    provider: "stripe",
    rail: "human",
    direction: "inflow",
    amountUsd: amountUsd || order.amountUsd,
    purpose: "app_purchase",
    externalId: session.id,
    metadata: { orderId, eventId: event.id, livemode: event.livemode },
  });
  if (posted === null) return;

  await db
    .update(orders)
    .set({ status: "fulfilling", stripeSessionId: session.id, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  await fulfil({ buildId: order.buildId, input: order.inputRef ?? "", orderId, rail: "human" });
}

async function onAbandoned(event: Stripe.Event): Promise<void> {
  const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
  const orderId = object.metadata?.agentfoundry_order;
  if (!orderId) return;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.status === "complete") return;

  await db.update(orders).set({ status: "failed", updatedAt: new Date() }).where(eq(orders.id, orderId));
}
