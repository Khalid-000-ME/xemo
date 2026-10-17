import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { economics, platformStats, recentLedger } from "@/lib/ledger";
import { readiness } from "@/lib/env";
import { Badge, Card, Empty, Label, Stat, usd } from "@/components/ui";

export const dynamic = "force-dynamic";

const RAIL_LABEL: Record<string, string> = {
  human: "Human · Stripe",
  agent: "Agent · x402",
  supplier: "Supplier · inference",
  compute: "Compute",
};

export default async function Dashboard() {
  const [econ, stats, rows, allBuilds, rails] = await Promise.all([
    economics(),
    platformStats(),
    recentLedger(25),
    db
      .select({
        id: builds.id,
        productName: builds.productName,
        status: builds.status,
        origin: builds.origin,
        appUrl: builds.appUrl,
        humanPriceUsd: builds.humanPriceUsd,
        agentPriceUsd: builds.agentPriceUsd,
      })
      .from(builds)
      .orderBy(desc(builds.createdAt))
      .limit(12),
    Promise.resolve(readiness()),
  ]);

  const notReady = rails.filter((r) => !r.ready);
  // Revenue bar proportions; guarded so an empty ledger renders a flat bar.
  const revenueTotal = Math.max(econ.revenueUsd, 0.000001);
  const humanShare = (econ.humanRevenueUsd / revenueTotal) * 100;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[30px] font-semibold tracking-[-0.022em]">Economics</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Every build AgentFoundry ships earns on two rails and spends on two more. This is the whole
          business in one table.
        </p>
      </header>

      {notReady.length > 0 ? (
        <div
          className="rounded-xl border px-4 py-3 text-[13px] leading-relaxed"
          style={{ background: "var(--bg-subtle)", borderColor: "var(--line-strong)" }}
        >
          <strong
            className="font-semibold"
            style={{ color: notReady.some((r) => r.blocking) ? "var(--neg)" : "var(--warn)" }}
          >
            {notReady.length} rail{notReady.length === 1 ? "" : "s"} not configured
            {notReady.some((r) => r.blocking) ? " — builds will refuse to start" : ""}.
          </strong>{" "}
          <span style={{ color: "var(--fg-muted)" }}>
            Set {notReady.flatMap((r) => r.missing).join(", ")} in <code>.env.local</code>. Every figure below
            is a settled amount; there is no simulated mode.
          </span>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={usd(econ.revenueUsd)}
          tone="positive"
          sub={`${usd(econ.humanRevenueUsd)} from people · ${usd(econ.agentRevenueUsd)} from agents`}
        />
        <Stat
          label="Cost of goods"
          value={usd(econ.costUsd)}
          tone="negative"
          sub={`${usd(econ.supplierCostUsd)} inference · ${usd(econ.computeCostUsd)} sandbox compute`}
        />
        <Stat
          label="Gross margin"
          value={usd(econ.marginUsd)}
          tone={econ.marginUsd >= 0 ? "positive" : "negative"}
          sub={econ.marginPct === null ? "no revenue yet" : `${econ.marginPct.toFixed(1)}% of revenue`}
        />
        <Stat
          label="Builds shipped"
          value={`${stats.liveBuilds}/${stats.totalBuilds}`}
          tone="brand"
          sub={[
            stats.successRatePct === null ? null : `${stats.successRatePct}% success`,
            stats.avgBuildSeconds === null ? null : `${stats.avgBuildSeconds}s average`,
            stats.agentCommissioned > 0 ? `${stats.agentCommissioned} agent-commissioned` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </section>

      {econ.revenueUsd > 0 ? (
        <Card>
          <Label>Where revenue comes from</Label>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <div style={{ width: `${humanShare}%`, background: "var(--brand)" }} aria-hidden />
            <div style={{ width: `${100 - humanShare}%`, background: "var(--pos)" }} aria-hidden />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: "var(--brand)" }} />
              Humans {usd(econ.humanRevenueUsd)} ({humanShare.toFixed(0)}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: "var(--pos)" }} />
              Agents {usd(econ.agentRevenueUsd)} ({(100 - humanShare).toFixed(0)}%)
            </span>
          </div>
        </Card>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Deployed apps</h2>
        {allBuilds.length === 0 ? (
          <Empty title="Nothing shipped yet" hint="Start a build from the home page and it will appear here with its rails and margin." />
        ) : (
          <ul className="grid gap-2">
            {allBuilds.map((build) => (
              <li key={build.id}>
                <Link
                  href={`/build/${build.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-4 py-3 transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <span className="font-medium">{build.productName}</span>
                  <Badge status={build.status}>{build.status}</Badge>
                  {build.origin !== "dashboard" ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                      style={{ background: "var(--pos-soft)", color: "var(--pos)" }}
                    >
                      via {build.origin}
                    </span>
                  ) : null}
                  <span className="tnum ml-auto text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    {usd(build.humanPriceUsd)} human / {usd(build.agentPriceUsd)} agent
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Ledger</h2>
        {rows.length === 0 ? (
          <Empty title="No money has moved yet" hint="Revenue and cost rows appear here the moment a rail settles." />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: "var(--bg-subtle)", color: "var(--fg-faint)" }}>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">When</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Rail</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Purpose</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const inflow = row.direction === "inflow";
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="tnum whitespace-nowrap px-3 py-2 font-mono text-[12px]" style={{ color: "var(--fg-faint)" }}>
                        {row.createdAt instanceof Date
                          ? row.createdAt.toLocaleTimeString([], { hour12: false })
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{RAIL_LABEL[row.rail] ?? row.rail}</td>
                      <td className="px-3 py-2">{row.purpose.replace(/_/g, " ")}</td>
                      <td
                        className="tnum whitespace-nowrap px-3 py-2 text-right font-medium"
                        style={{ color: inflow ? "var(--pos)" : "var(--neg)" }}
                      >
                        {inflow ? "+" : "−"}
                        {usd(row.amountUsd)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
