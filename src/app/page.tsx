import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { capabilities, env } from "@/lib/env";
import { PromptForm } from "@/components/PromptForm";
import { Badge, Card, Label, Mono } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [recent, caps] = await Promise.all([
    db
      .select({
        id: builds.id,
        productName: builds.productName,
        status: builds.status,
        appUrl: builds.appUrl,
        simulated: builds.simulated,
      })
      .from(builds)
      .orderBy(desc(builds.createdAt))
      .limit(5),
    Promise.resolve(capabilities()),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="max-w-2xl text-[34px] font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[42px]">
          One prompt in. A business that sells to humans <em className="not-italic" style={{ color: "var(--brand)" }}>and</em> to agents out.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          AgentFoundry plans a product, writes it, runs it in a CreateOS microVM, publishes it to a public URL,
          then opens both payment rails: Stripe Checkout for people, and an{" "}
          <a href="https://x402.org" className="underline decoration-dotted underline-offset-2" style={{ color: "var(--brand)" }}>
            x402
          </a>{" "}
          endpoint for machines. Every dollar in and every cent out lands in one ledger.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <Card as="section">
          <PromptForm />
        </Card>

        <div className="space-y-6">
          <Card>
            <Label>Live rails</Label>
            <ul className="mt-2 space-y-2.5">
              {caps.map((cap) => (
                <li key={cap.id} className="flex items-start gap-2.5 text-[13px]">
                  <span
                    aria-hidden
                    className="mt-[6px] size-2 shrink-0 rounded-full"
                    style={{ background: cap.live ? "var(--pos)" : "var(--line-strong)" }}
                  />
                  <span>
                    <span className="font-medium">{cap.label}</span>
                    <span className="sr-only">{cap.live ? " — live" : " — not configured"}</span>
                    <span className="block leading-snug" style={{ color: "var(--fg-muted)" }}>
                      {cap.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <Label>Buy a build as an agent</Label>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              AppFactory is itself sold over x402 at{" "}
              <strong style={{ color: "var(--fg)" }}>${env.x402.commissionPriceUsd.toFixed(2)}</strong> per build, on{" "}
              <Mono>{env.x402.network}</Mono>. A PayBox-connected agent discovers it, pays, and gets a deployed app
              back in one call.
            </p>
            <pre
              className="mt-3 overflow-x-auto rounded-lg border p-3 font-mono text-[12px] leading-relaxed"
              style={{ background: "var(--bg)" }}
            >
{`POST ${env.appUrl}/api/x402/commission
{"prompt": "Build a paid AI resume reviewer", "priceUsd": 5}

→ 402 Payment Required  (payment requirements)
→ retry with X-PAYMENT  → live app + both rails`}
            </pre>
          </Card>
        </div>
      </section>

      {recent.length > 0 ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recent builds</h2>
            <Link href="/dashboard" className="text-[13px] underline decoration-dotted underline-offset-2" style={{ color: "var(--brand)" }}>
              See the economics →
            </Link>
          </div>
          <ul className="grid gap-2">
            {recent.map((build) => (
              <li key={build.id}>
                <Link
                  href={`/build/${build.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <span className="font-medium">{build.productName}</span>
                  <Badge status={build.status}>{build.status}</Badge>
                  {build.simulated ? (
                    <span className="text-[12px]" style={{ color: "var(--warn)" }}>
                      simulated
                    </span>
                  ) : null}
                  <span className="ml-auto font-mono text-[12px]" style={{ color: "var(--fg-faint)" }}>
                    {build.id}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
