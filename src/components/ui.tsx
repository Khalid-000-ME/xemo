import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag
      className={`rounded-[28px] p-6 ${className}`}
      style={{ background: "var(--bg-subtle)", boxShadow: "var(--shadow)" }}
    >
      {children}
    </Tag>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.08em]"
      style={{ color: "var(--fg-faint)" }}
    >
      {children}
    </div>
  );
}

/** A headline figure. `tone` colours gains and losses without relying on hue alone. */
export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative" | "brand";
}) {
  const color =
    tone === "positive"
      ? "var(--pos)"
      : tone === "negative"
        ? "var(--neg)"
        : tone === "brand"
          ? "var(--brand)"
          : "var(--fg)";
  return (
    <Card>
      <Label>{label}</Label>
      <div className="tnum text-2xl font-semibold tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[13px] leading-snug" style={{ color: "var(--fg-muted)" }}>
          {sub}
        </div>
      ) : null}
    </Card>
  );
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  live: { bg: "var(--pos-soft)", fg: "var(--pos)" },
  done: { bg: "var(--pos-soft)", fg: "var(--pos)" },
  failed: { bg: "var(--neg-soft)", fg: "var(--neg)" },
  queued: { bg: "var(--bg-subtle)", fg: "var(--fg-muted)" },
};

export function Badge({ children, status }: { children: ReactNode; status?: string }) {
  const tone = (status && STATUS_TONE[status]) || { bg: "var(--brand-soft)", fg: "var(--brand)" };
  const running = status && !["live", "failed", "queued", "done"].includes(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${running ? "af-pulse" : ""}`}
      style={{ background: tone.bg, color: tone.fg }}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`af-spin inline-block size-3.5 rounded-full border-2 align-[-2px] ${className}`}
      style={{ borderColor: "var(--line-strong)", borderTopColor: "var(--brand)" }}
    />
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <code
      className="rounded-md border px-1.5 py-0.5 font-mono text-[12.5px] break-all"
      style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
    >
      {children}
    </code>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      className="rounded-xl border border-dashed px-5 py-10 text-center"
      style={{ borderColor: "var(--line-strong)" }}
    >
      <div className="text-sm font-medium">{title}</div>
      {hint ? (
        <div className="mx-auto mt-1 max-w-sm text-[13px]" style={{ color: "var(--fg-muted)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export const usd = (n: number, digits?: number) =>
  `$${n.toFixed(digits ?? (Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 4 : 2))}`;
