import Image from "next/image";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { env, readiness } from "@/lib/env";
import { PromptForm } from "@/components/PromptForm";
import { Badge, Card, Mono } from "@/components/ui";

export const dynamic = "force-dynamic";

const STEPS = [
  ["Plan", "A structured product spec from your brief: name, tagline, unit, price"],
  ["Generate", "A working storefront rendered from a vetted template, never free-form shell"],
  ["Test and deploy", "Typecheck and assertions inside a CreateOS microVM, then a public URL"],
  ["Open both rails", "Stripe Checkout for humans and an x402 endpoint for agents"],
  ["Measure", "Revenue, inference cost and compute cost in one ledger"],
];

const H2 = "text-[44px] font-normal leading-[1.05] tracking-[-0.03em] sm:text-[56px]";
const SPLIT = "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]";

export default async function Home() {
  const [recent, rails] = await Promise.all([
    db
      .select({
        id: builds.id,
        productName: builds.productName,
        status: builds.status,
        appUrl: builds.appUrl,
      })
      .from(builds)
      .orderBy(desc(builds.createdAt))
      .limit(5),
    Promise.resolve(readiness()),
  ]);

  return (
    <div>
      <section className="px-3">
        <div className="relative isolate flex h-[calc(100svh-96px)] min-h-[560px] max-h-[900px] items-center justify-center overflow-hidden rounded-[32px] px-6 text-center">
          <Image src="/hero.jpg" alt="" fill priority sizes="100vw" className="-z-10 object-cover" />
          <div className="mx-auto max-w-4xl">
            <h1 className="font-serif text-[48px] leading-[1.02] tracking-[-0.02em] text-[#0c0c0e] sm:text-[72px] lg:text-[88px]">
              One prompt in. A business that sells to humans <em>and</em> to agents out.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-[#26262c] sm:text-[18px]">
              Xemo plans, builds, deploys and monetizes a micro-SaaS, with Stripe for people and x402 for machines.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a href="#build" className="rounded-full bg-[#0c0c0e] px-6 py-3 text-[15px] font-medium text-white transition-opacity hover:opacity-85">
                Start building
              </a>
              <Link href="/dashboard" className="rounded-full bg-white/80 px-6 py-3 text-[15px] font-medium text-[#0c0c0e] backdrop-blur transition-colors hover:bg-white">
                See the economics
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-28 px-6 pt-28">
        <section id="build" className={`scroll-mt-8 ${SPLIT}`}>
          <div>
            <h2 className={H2}>Commission a business</h2>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Describe the product and the price. The agent does the rest and shows you every step as it happens.
            </p>
          </div>
          <Card as="section">
            <PromptForm />
          </Card>
        </section>

        <section>
          <h2 className={H2}>What it runs on</h2>
          <p className="mt-4 text-[16px]" style={{ color: "var(--fg-muted)" }}>
            Live readiness of every rail this deployment depends on.
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rails.map((rail) => (
              <li key={rail.id} className="rounded-[28px] p-6" style={{ background: "var(--bg-subtle)" }}>
                <div className="flex items-center gap-2.5 text-[17px]">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: rail.ready ? "var(--pos)" : rail.blocking ? "var(--neg)" : "var(--line-strong)" }}
                  />
                  {rail.label}
                  <span className="sr-only">
                    {rail.ready ? " — ready" : rail.blocking ? " — missing, required" : " — missing, optional"}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[12.5px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                  {rail.ready ? rail.detail : `${rail.missing.join(", ")} — ${rail.detail}`}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className={SPLIT}>
          <div>
            <h2 className={H2}>How a build runs</h2>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Five steps, each recorded with its real duration and cost.
            </p>
          </div>
          <ol>
            {STEPS.map(([title, note], i) => (
              <li key={title} className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-4 gap-y-1 border-b py-6 first:pt-0 sm:grid-cols-[2.5rem_14rem_1fr]">
                <span className="font-mono text-[13px]" style={{ color: "var(--fg-faint)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[22px] tracking-[-0.01em]">{title}</span>
                <span className="col-start-2 text-[15px] sm:col-start-auto" style={{ color: "var(--fg-muted)" }}>
                  {note}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className={SPLIT}>
          <div>
            <h2 className={H2}>Buy a build as an agent</h2>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Xemo is itself sold over x402 at <strong style={{ color: "var(--fg)" }}>${env.x402.commissionPriceUsd.toFixed(2)}</strong> per
              build, on <Mono>{env.x402.network}</Mono>. A PayBox-connected agent discovers it, pays, and gets a deployed app back in one call.
            </p>
          </div>
          <Card>
            <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
{`POST ${env.appUrl}/api/x402/commission
{"prompt": "Build a paid AI resume reviewer", "priceUsd": 5}

→ 402 Payment Required  (payment requirements)
→ retry with X-PAYMENT  → live app + both rails`}
            </pre>
          </Card>
        </section>

        {recent.length > 0 ? (
          <section>
            <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className={H2}>Recent builds</h2>
              <Link href="/dashboard" className="text-[14px] underline decoration-dotted underline-offset-4" style={{ color: "var(--fg-muted)" }}>
                See the economics →
              </Link>
            </div>
            <ul>
              {recent.map((build, i) => (
                <li key={build.id}>
                  <Link
                    href={`/build/${build.id}`}
                    className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-4 border-b py-5 transition-colors hover:bg-[var(--bg-subtle)] sm:grid-cols-[2.5rem_1fr_auto_12rem]"
                  >
                    <span className="pl-1 font-mono text-[13px]" style={{ color: "var(--fg-faint)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[20px] tracking-[-0.01em]">{build.productName}</span>
                    <Badge status={build.status}>{build.status}</Badge>
                    <span className="hidden text-right font-mono text-[12px] sm:block" style={{ color: "var(--fg-faint)" }}>
                      {build.id}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
