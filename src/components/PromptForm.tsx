"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = [
  {
    label: "AI resume reviewer",
    prompt:
      "Build a paid AI resume reviewer. Charge $5 per review. Score the resume out of 100, list strengths and specific improvements, and rewrite the professional summary.",
    name: "ResumeForge",
    price: 5,
  },
  {
    label: "Cold email auditor",
    prompt:
      "Build a paid cold email auditor for founders. Charge $4 per audit. Score the email's likelihood of a reply, flag spam triggers, and rewrite the opening line three different ways.",
    name: "ReplyRate",
    price: 4,
  },
  {
    label: "Contract clause checker",
    prompt:
      "Build a paid contract clause checker for freelancers. Charge $9 per check. Flag clauses that are unusually risky for the contractor, explain why in plain English, and suggest safer wording.",
    name: "ClauseGuard",
    price: 9,
  },
];

export function PromptForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [productName, setProductName] = useState(EXAMPLES[0].name);
  const [priceUsd, setPriceUsd] = useState(String(EXAMPLES[0].price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/create-app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          productName: productName.trim() || undefined,
          priceUsd: Number(priceUsd) || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `request failed (${res.status})`);
      router.push(`/build/${body.buildId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start the build");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => {
              setPrompt(example.prompt);
              setProductName(example.name);
              setPriceUsd(String(example.price));
            }}
            className="rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-[var(--bg-subtle)]"
            style={{ color: "var(--fg-muted)" }}
          >
            {example.label}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="prompt" className="mb-1.5 block text-sm font-medium">
          Product brief
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          rows={5}
          required
          className="w-full resize-y rounded-lg border p-3 font-mono text-[13.5px] leading-relaxed outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/25"
          style={{ background: "var(--bg)", color: "var(--fg)" }}
          placeholder="Build a paid… charge $… per…"
        />
        <div className="mt-1 text-right text-[12px] tnum" style={{ color: "var(--fg-faint)" }}>
          {prompt.length}/2000
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
            Product name <span style={{ color: "var(--fg-faint)" }}>(optional)</span>
          </label>
          <input
            id="name"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            maxLength={60}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/25"
            style={{ background: "var(--bg)", color: "var(--fg)" }}
            placeholder="The agent will pick one"
          />
        </div>
        <div>
          <label htmlFor="price" className="mb-1.5 block text-sm font-medium">
            Human price
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--fg-faint)" }}>
              $
            </span>
            <input
              id="price"
              type="number"
              min={1}
              max={100}
              step={1}
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              className="tnum w-full rounded-lg border py-2 pl-7 pr-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/25"
              style={{ background: "var(--bg)", color: "var(--fg)" }}
            />
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border px-3 py-2 text-[13px]" style={{ background: "var(--neg-soft)", color: "var(--neg)" }}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || prompt.trim().length < 10}
        className="w-full rounded-lg px-4 py-3 text-[15px] font-semibold text-white transition-opacity disabled:opacity-55"
        style={{ background: "var(--brand)" }}
      >
        {busy ? "Starting the agent…" : "Build, deploy and monetize it"}
      </button>
      <p className="text-center text-[12.5px]" style={{ color: "var(--fg-faint)" }}>
        The agent plans the product, writes it, tests it in a CreateOS sandbox, publishes it, and opens both
        payment rails.
      </p>
    </form>
  );
}
