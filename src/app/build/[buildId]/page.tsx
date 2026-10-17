import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, generatedFiles } from "@/lib/db/schema";
import { listEvents } from "@/lib/events";
import { economics } from "@/lib/ledger";
import { env } from "@/lib/env";
import { productSpecSchema } from "@/lib/agent/spec";
import { BuildTimeline } from "@/components/BuildTimeline";
import { Badge, Card, Label, Mono, Stat, usd } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BuildPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;

  const [build] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1);
  if (!build) notFound();

  const [events, files, econ] = await Promise.all([
    listEvents(buildId),
    db
      .select({ path: generatedFiles.path, bytes: generatedFiles.bytes, language: generatedFiles.language })
      .from(generatedFiles)
      .where(eq(generatedFiles.buildId, buildId))
      .orderBy(asc(generatedFiles.path)),
    economics(buildId),
  ]);

  const spec = productSpecSchema.safeParse(build.plan);
  const buildSeconds =
    build.completedAt && build.startedAt
      ? Math.max(0, Math.round((build.completedAt.getTime() - build.startedAt.getTime()) / 1000))
      : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link href="/" className="text-[13px] underline decoration-dotted underline-offset-2" style={{ color: "var(--fg-muted)" }}>
          ← New build
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[30px] font-semibold tracking-[-0.022em]">{build.productName}</h1>
          <Badge status={build.status}>{build.status}</Badge>
        </div>
        {spec.success ? (
          <p className="max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {spec.data.tagline}
          </p>
        ) : null}
        {build.statusDetail ? (
          <p className="rounded-lg border px-3 py-2 text-[13px]" style={{ background: "var(--neg-soft)", color: "var(--neg)" }}>
            {build.statusDetail}
          </p>
        ) : null}
      </header>

      {build.status === "live" ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <Card>
            <Label>Human rail · Stripe</Label>
            <div className="mt-1 text-[15px] font-semibold">{usd(build.humanPriceUsd)} per {spec.success ? spec.data.unit : "unit"}</div>
            {build.appUrl ? (
              <a
                href={build.appUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block rounded-lg px-3.5 py-2 text-[13.5px] font-semibold text-white"
                style={{ background: "var(--brand)" }}
              >
                Open the live storefront ↗
              </a>
            ) : null}
            {build.stripeProductId ? (
              <div className="mt-2 text-[12px]" style={{ color: "var(--fg-faint)" }}>
                <Mono>{build.stripeProductId}</Mono>
              </div>
            ) : (
              <div className="mt-2 text-[12px]" style={{ color: "var(--warn)" }}>
                Stripe not configured — checkout is simulated
              </div>
            )}
          </Card>

          <Card>
            <Label>Agent rail · x402</Label>
            <div className="mt-1 text-[15px] font-semibold">{usd(build.agentPriceUsd)} per call</div>
            {build.agentEndpointUrl ? (
              <pre
                className="mt-2 overflow-x-auto rounded-md border p-2.5 font-mono text-[11.5px] leading-relaxed"
                style={{ background: "var(--bg)" }}
              >
{`curl -X POST ${build.agentEndpointUrl} \\
  -H 'content-type: application/json' \\
  -d '{"input":"…"}'`}
              </pre>
            ) : null}
            <div className="mt-2 text-[12px]" style={{ color: "var(--fg-faint)" }}>
              <Mono>{env.x402.network}</Mono>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue" value={usd(econ.revenueUsd)} tone="positive" sub={`${usd(econ.humanRevenueUsd)} human · ${usd(econ.agentRevenueUsd)} agent`} />
        <Stat label="Cost of goods" value={usd(econ.costUsd)} tone="negative" sub={`${usd(econ.supplierCostUsd)} supplier · ${usd(econ.computeCostUsd)} compute`} />
        <Stat
          label="Gross margin"
          value={usd(econ.marginUsd)}
          tone={econ.marginUsd >= 0 ? "positive" : "negative"}
          sub={econ.marginPct === null ? "no revenue yet" : `${econ.marginPct.toFixed(1)}% margin`}
        />
        <Stat
          label="Build time"
          value={buildSeconds === null ? "—" : `${buildSeconds}s`}
          tone="brand"
          sub={`${files.length} files · ${build.sandboxId ? build.sandboxId.slice(0, 18) : "no sandbox"}`}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <h2 className="mb-3 text-sm font-semibold">Agent timeline</h2>
          <BuildTimeline buildId={buildId} initialEvents={events} initialStatus={build.status} />
        </div>

        <div className="space-y-6">
          {spec.success ? (
            <Card>
              <Label>What a buyer receives</Label>
              <ul className="mt-2 space-y-2">
                {spec.data.outputFields.map((field) => (
                  <li key={field.key} className="text-[13px]">
                    <span className="font-medium">{field.label}</span>
                    <span className="ml-1.5 font-mono text-[11px]" style={{ color: "var(--fg-faint)" }}>
                      {field.type}
                    </span>
                    <span className="block leading-snug" style={{ color: "var(--fg-muted)" }}>
                      {field.description}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {files.length > 0 ? (
            <Card>
              <Label>Generated files</Label>
              <ul className="mt-2 space-y-1.5">
                {files.map((file) => (
                  <li key={file.path} className="flex items-baseline gap-2 font-mono text-[12.5px]">
                    <span className="truncate">{file.path}</span>
                    <span className="tnum ml-auto shrink-0" style={{ color: "var(--fg-faint)" }}>
                      {(file.bytes / 1024).toFixed(1)} kB
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
