import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Order state, polled by the storefront's result page.
 *
 * Read-only. An order only ever becomes `complete` through the verified Stripe
 * webhook, so this route cannot be used to obtain a deliverable without paying.
 * It never echoes the buyer's submitted input back over the wire.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail(404, "ORDER_NOT_FOUND", `no order with id ${orderId}`);

  return ok({
    orderId: order.id,
    buildId: order.buildId,
    status: order.status,
    result: order.result ?? null,
    amountUsd: order.amountUsd,
  });
}
