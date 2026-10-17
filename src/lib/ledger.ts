import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, ledger, processedEvents } from "@/lib/db/schema";
import { newLedgerId } from "@/lib/ids";
import { recordEvent } from "@/lib/events";
import { env } from "@/lib/env";

export type Rail = "human" | "agent" | "compute" | "supplier";
export type Direction = "inflow" | "outflow";

export type PostEntry = {
  buildId?: string | null;
  provider: "stripe" | "x402" | "paybox" | "createos";
  rail: Rail;
  direction: Direction;
  amountUsd: number;
  purpose: string;
  externalId?: string | null;
  /** false when the amount is a known list price we did not actually settle. */
  settled?: boolean;
  status?: "pending" | "succeeded" | "failed" | "refunded";
  metadata?: Record<string, unknown>;
};

/**
 * Post one money movement. Idempotent on `(provider, externalId)` so Stripe
 * webhook replays and x402 retries cannot double-count revenue.
 *
 * Returns null when the entry was a duplicate.
 */
export async function post(entry: PostEntry): Promise<string | null> {
  const key = entry.externalId ? `${entry.provider}:${entry.externalId}` : null;

  if (key) {
    const existing = await db.select().from(processedEvents).where(eq(processedEvents.id, key)).limit(1);
    if (existing.length > 0) return null;
  }

  const rowId = newLedgerId();
  try {
    await db.insert(ledger).values({
      id: rowId,
      buildId: entry.buildId ?? null,
      provider: entry.provider,
      rail: entry.rail,
      direction: entry.direction,
      amountUsd: round(entry.amountUsd),
      purpose: entry.purpose,
      externalId: entry.externalId ?? null,
      settled: entry.settled ?? true,
      status: entry.status ?? "succeeded",
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    // Unique index on (provider, external_id) — a concurrent duplicate.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }

  if (key) {
    await db.insert(processedEvents).values({ id: key, provider: entry.provider }).onConflictDoNothing();
  }

  if (entry.buildId) {
    const sign = entry.direction === "inflow" ? "+" : "−";
    await recordEvent(
      entry.buildId,
      entry.direction === "inflow"
        ? entry.provider === "stripe"
          ? "payment_received"
          : "x402_payment"
        : "cost",
      `${sign}$${round(entry.amountUsd).toFixed(4)} ${labelFor(entry)}`,
      entry.settled === false ? "recorded at list price (not settled)" : null,
      { provider: entry.provider, rail: entry.rail, purpose: entry.purpose, externalId: entry.externalId },
    );
  }

  return rowId;
}

function labelFor(e: PostEntry): string {
  switch (e.purpose) {
    case "commission":
      return "agent commissioned a build (x402)";
    case "app_purchase":
      return "customer bought from the generated app (Stripe)";
    case "agent_api_call":
      return "agent called the generated app (x402)";
    case "sandbox_compute":
      return "CreateOS sandbox compute";
    case "llm_inference":
      return "LLM inference";
    default:
      return e.purpose.replace(/_/g, " ");
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export type Economics = {
  humanRevenueUsd: number;
  agentRevenueUsd: number;
  revenueUsd: number;
  supplierCostUsd: number;
  computeCostUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number | null;
  unsettledUsd: number;
};

function emptyEconomics(): Economics {
  return {
    humanRevenueUsd: 0,
    agentRevenueUsd: 0,
    revenueUsd: 0,
    supplierCostUsd: 0,
    computeCostUsd: 0,
    costUsd: 0,
    marginUsd: 0,
    marginPct: null,
    unsettledUsd: 0,
  };
}

export async function economics(buildId?: string): Promise<Economics> {
  const rows = buildId
    ? await db.select().from(ledger).where(eq(ledger.buildId, buildId))
    : await db.select().from(ledger);

  const out = emptyEconomics();
  for (const r of rows) {
    if (r.status === "failed") continue;
    const amt = r.amountUsd;
    if (r.direction === "inflow") {
      if (r.rail === "agent") out.agentRevenueUsd += amt;
      else out.humanRevenueUsd += amt;
    } else {
      if (r.rail === "compute") out.computeCostUsd += amt;
      else out.supplierCostUsd += amt;
    }
    if (!r.settled) out.unsettledUsd += amt;
  }

  out.humanRevenueUsd = round(out.humanRevenueUsd);
  out.agentRevenueUsd = round(out.agentRevenueUsd);
  out.revenueUsd = round(out.humanRevenueUsd + out.agentRevenueUsd);
  out.supplierCostUsd = round(out.supplierCostUsd);
  out.computeCostUsd = round(out.computeCostUsd);
  out.costUsd = round(out.supplierCostUsd + out.computeCostUsd);
  out.marginUsd = round(out.revenueUsd - out.costUsd);
  out.marginPct = out.revenueUsd > 0 ? round((out.marginUsd / out.revenueUsd) * 100) : null;
  out.unsettledUsd = round(out.unsettledUsd);
  return out;
}

/** Price sandbox wall-clock into the ledger so margin includes real compute. */
export function computeCostUsd(shape: string, seconds: number): number {
  const m = /^s-([\d.]+)vcpu-(\d+)(gb|mb)$/.exec(shape);
  const vcpu = m ? Number(m[1]) : 1;
  const mem = m ? (m[3] === "gb" ? Number(m[2]) : Number(m[2]) / 1024) : 1;
  const hours = seconds / 3600;
  return round(hours * (vcpu * env.createos.usdPerVcpuHour + mem * env.createos.usdPerGibHour));
}

export async function recentLedger(limit = 40) {
  return db.select().from(ledger).orderBy(desc(ledger.createdAt)).limit(limit);
}

export type PlatformStats = {
  totalBuilds: number;
  liveBuilds: number;
  failedBuilds: number;
  successRatePct: number | null;
  avgBuildSeconds: number | null;
  agentCommissioned: number;
};

export async function platformStats(): Promise<PlatformStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      live: sql<number>`sum(case when ${builds.status} = 'live' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${builds.status} = 'failed' then 1 else 0 end)`,
      avgSeconds: sql<number | null>`avg(case when ${builds.completedAt} is not null
        then ${builds.completedAt} - ${builds.startedAt} end)`,
      fromAgents: sql<number>`sum(case when ${builds.origin} in ('x402','mcp') then 1 else 0 end)`,
    })
    .from(builds);

  const total = Number(row?.total ?? 0);
  const live = Number(row?.live ?? 0);
  const failed = Number(row?.failed ?? 0);
  const finished = live + failed;

  return {
    totalBuilds: total,
    liveBuilds: live,
    failedBuilds: failed,
    successRatePct: finished > 0 ? Math.round((live / finished) * 100) : null,
    avgBuildSeconds: row?.avgSeconds != null ? Math.round(Number(row.avgSeconds)) : null,
    agentCommissioned: Number(row?.fromAgents ?? 0),
  };
}
