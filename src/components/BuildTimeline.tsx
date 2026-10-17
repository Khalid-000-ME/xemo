"use client";

import { useEffect, useRef, useState } from "react";

type TimelineEvent = {
  id: string;
  seq: number;
  type: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

const TERMINAL = new Set(["live", "failed"]);

const ICON: Record<string, string> = {
  plan: "◇",
  file_created: "+",
  command_started: "▸",
  command_completed: "✓",
  test_passed: "✓",
  test_failed: "✕",
  deploy_started: "▸",
  deploy_completed: "▲",
  stripe_created: "$",
  x402_listed: "⇄",
  payment_received: "$",
  x402_payment: "⇄",
  cost: "−",
  error: "✕",
  done: "★",
};

function toneOf(type: string): string {
  if (type === "error" || type === "test_failed") return "var(--neg)";
  if (type === "done" || type === "test_passed" || type === "deploy_completed") return "var(--pos)";
  if (type === "cost") return "var(--warn)";
  if (type === "payment_received" || type === "x402_payment" || type === "stripe_created" || type === "x402_listed")
    return "var(--brand)";
  return "var(--fg-faint)";
}

export function BuildTimeline({
  buildId,
  initialEvents,
  initialStatus,
}: {
  buildId: string;
  initialEvents: TimelineEvent[];
  initialStatus: string;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const seenRef = useRef(new Set(initialEvents.map((e) => e.seq)));
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (TERMINAL.has(status)) return;

    const lastSeq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) : 0;
    const source = new EventSource(`/api/builds/${buildId}/stream?after=${lastSeq}`);

    source.addEventListener("build", (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as TimelineEvent;
        if (seenRef.current.has(event.seq)) return;
        seenRef.current.add(event.seq);
        setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));
        if (event.type === "done") setStatus("live");
        if (event.type === "error" && event.title === "Build failed") setStatus("failed");
      } catch {
        // a malformed frame must not break the stream
      }
    });

    // The stream closes itself on a terminal event; refresh so the server
    // components above re-read the finished build.
    source.addEventListener("end", () => {
      source.close();
      setTimeout(() => window.location.reload(), 600);
    });

    source.onerror = () => source.close();

    return () => source.close();
    // Re-subscribing on every event would thrash the connection; the stream
    // replays from `after` on mount, which covers anything missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId, status]);

  useEffect(() => {
    if (TERMINAL.has(status)) return;
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length, status]);

  return (
    <ol ref={listRef} className="relative space-y-0">
      {events.map((event, index) => {
        const tone = toneOf(event.type);
        const isLast = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 pl-0.5">
            {!isLast ? (
              <span
                aria-hidden
                className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px"
                style={{ background: "var(--line)" }}
              />
            ) : null}
            <span
              aria-hidden
              className="relative z-10 grid size-[23px] shrink-0 place-items-center rounded-full border font-mono text-[11px]"
              style={{ background: "var(--bg)", color: tone, borderColor: "var(--line-strong)" }}
            >
              {ICON[event.type] ?? "·"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[14px] font-medium" style={{ color: tone === "var(--fg-faint)" ? "var(--fg)" : tone }}>
                  {event.title}
                </span>
                <time
                  className="tnum font-mono text-[11.5px]"
                  style={{ color: "var(--fg-faint)" }}
                  dateTime={new Date(event.createdAt).toISOString()}
                >
                  {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                </time>
              </div>
              {event.detail ? (
                <pre
                  className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border px-2.5 py-2 font-mono text-[12px] leading-relaxed"
                  style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
                >
                  {event.detail}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}

      {!TERMINAL.has(status) ? (
        <li className="flex items-center gap-3 pl-0.5 text-[13px]" style={{ color: "var(--fg-muted)" }}>
          <span
            aria-hidden
            className="af-spin grid size-[23px] shrink-0 place-items-center rounded-full border-2"
            style={{ borderColor: "var(--line-strong)", borderTopColor: "var(--brand)" }}
          />
          <span className="af-pulse">{status}…</span>
        </li>
      ) : null}
    </ol>
  );
}
