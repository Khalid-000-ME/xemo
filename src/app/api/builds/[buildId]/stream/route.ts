import { listEvents, subscribe, type EmittedEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events for one build's timeline.
 *
 * Replays everything after `?after=` before attaching the live listener, so a
 * reconnecting client never has a gap and never sees a duplicate.
 */
export async function GET(req: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let highWater = after;
      let closed = false;

      const send = (event: EmittedEvent) => {
        if (closed || event.seq <= highWater) return;
        highWater = event.seq;
        try {
          controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: build\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
        if (event.type === "done" || (event.type === "error" && event.title === "Build failed")) {
          finish();
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
        } catch {
          // already torn down
        }
      };

      // Attach first, then replay, so an event fired mid-replay is not lost.
      const buffered: EmittedEvent[] = [];
      let replaying = true;
      unsubscribe = subscribe(buildId, (event) => {
        if (replaying) buffered.push(event);
        else send(event);
      });

      for (const event of await listEvents(buildId, after)) send(event);
      replaying = false;
      for (const event of buffered) send(event);

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          finish();
        }
      }, 15_000);

      req.signal.addEventListener("abort", finish);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
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
