import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { stripeConfigured } from "@/lib/stripe/client";
import { fulfil } from "@/lib/agent/fulfil";
import { post } from "@/lib/ledger";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Order state, polled by the storefront's result page.
 *
 * Never reveals the buyer's submitted input back over the wire — only status
 * and the deliverable they paid for.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail(404, "ORDER_NOT_FOUND", `no order with id ${orderId}`);

  // Without Stripe configured there is no webhook to confirm payment, so a
  // created order is fulfilled on first read and labelled as simulated.
  if (order.status === "created" && !stripeConfigured()) {
    await post({
      buildId: order.buildId,
      provider: "stripe",
      rail: "human",
      direction: "inflow",
      amountUsd: order.amountUsd,
      purpose: "app_purchase",
      externalId: `sim:${order.id}`,
      settled: false,
      metadata: { simulated: true },
    });
    try {
      const { result, simulated, note } = await fulfil({
        buildId: order.buildId,
        input: order.inputRef ?? "",
        orderId: order.id,
        rail: "human",
      });
      return ok({ orderId, status: "complete", result, simulated: true, note: note ?? "payment simulated" });
      void simulated;
    } catch (err) {
      return ok({ orderId, status: "failed", error: err instanceof Error ? err.message : "fulfilment failed" });
    }
  }

  return ok({
    orderId: order.id,
    buildId: order.buildId,
    status: order.status,
    result: order.result ?? null,
    amountUsd: order.amountUsd,
  });
}
