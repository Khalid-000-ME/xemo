import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, orders } from "@/lib/db/schema";
import { newOrderId } from "@/lib/ids";
import { createCheckoutSession } from "@/lib/stripe/products";
import { fail, ok, readJson, str } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Called by a generated storefront to open the human rail.
 *
 * The storefront holds no keys, so it posts the buyer's input here and gets a
 * Stripe Checkout URL back. The input is stored against the order and only
 * fulfilled once the webhook confirms payment.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const buildId = str(body.buildId);
  const input = str(body.input);

  if (!buildId) return fail(400, "BUILD_ID_REQUIRED", "buildId is required");
  if (!input) return fail(400, "INPUT_REQUIRED", "input is required");
  if (input.length < 40) return fail(400, "INPUT_TOO_SHORT", "input must be at least 40 characters");
  if (input.length > 60_000) return fail(413, "INPUT_TOO_LONG", "input must be under 60,000 characters");

  const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
  if (!build) return fail(404, "BUILD_NOT_FOUND", `no build with id ${buildId}`);
  if (!build.appUrl) return fail(409, "BUILD_NOT_LIVE", "this app is not live yet");

  const orderId = newOrderId();
  await db.insert(orders).values({
    id: orderId,
    buildId,
    rail: "human",
    status: "created",
    inputRef: input,
    amountUsd: build.humanPriceUsd,
  });

  try {
    const session = await createCheckoutSession({
      buildId,
      orderId,
      priceId: build.stripePriceId,
      priceUsd: build.humanPriceUsd,
      productName: build.productName,
      successUrl: `${build.appUrl}/order?id=${orderId}`,
      cancelUrl: `${build.appUrl}/?cancelled=${orderId}`,
    });

    if (session.sessionId) {
      await db
        .update(orders)
        .set({ stripeSessionId: session.sessionId, updatedAt: new Date() })
        .where(eq(orders.id, orderId));
    }

    return ok({ orderId, checkoutUrl: session.url, simulated: session.simulated });
  } catch (err) {
    await db.update(orders).set({ status: "failed", updatedAt: new Date() }).where(eq(orders.id, orderId));
    return fail(502, "CHECKOUT_FAILED", err instanceof Error ? err.message : "could not create a checkout session");
  }
}
