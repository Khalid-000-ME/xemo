import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { listEvents, type EmittedEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 1000;
const TERMINAL = new Set(["live", "failed"]);

/**
 * Server-sent events for one build's timeline.
 *
 * This polls the database instead of subscribing to an in-process bus. On a
 * serverless platform the invocation running the build and the invocation
 * streaming it are different instances, so an in-memory fan-out would never see
 * the build's events. Events are persisted before anything else happens, which
 * makes the database the one source every instance agrees on.
 *
 * `?after=N` resumes from a sequence number, so a reconnect has no gap and no
 * duplicate.
 */
export async function GET(req: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;

  const encoder = new TextEncoder();
  let stopped = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let highWater = after;

      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stopped = true;
        }
      };

      const finish = () => {
        if (stopped) return;
        stopped = true;
        write("event: end\ndata: {}\n\n");
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", () => {
        stopped = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      let idleBeats = 0;

      while (!stopped) {
        let events: EmittedEvent[];
        try {
          events = await listEvents(buildId, highWater);
        } catch {
          // A transient database error should not tear down the stream.
          events = [];
        }

        for (const event of events) {
          highWater = event.seq;
          write(`id: ${event.seq}\nevent: build\ndata: ${JSON.stringify(event)}\n\n`);
        }

        if (events.length > 0) {
          idleBeats = 0;
        } else if (++idleBeats % 15 === 0) {
          write(": keep-alive\n\n");
        }

        // Stop once the build is terminal and everything it wrote has been sent.
        // Checking status after the events, not before, means a final event that
        // landed between the two reads is never dropped.
        if (events.length === 0) {
          const [row] = await db
            .select({ status: builds.status })
            .from(builds)
            .where(eq(builds.id, buildId))
            .limit(1)
            .catch(() => []);

          if (!row) return finish(); // unknown build
          if (TERMINAL.has(row.status)) {
            const rest = await listEvents(buildId, highWater).catch(() => []);
            for (const event of rest) {
              highWater = event.seq;
              write(`id: ${event.seq}\nevent: build\ndata: ${JSON.stringify(event)}\n\n`);
            }
            return finish();
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
