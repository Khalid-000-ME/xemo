import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildEvents } from "@/lib/db/schema";
import { newEventId } from "@/lib/ids";

export type BuildEventType =
  | "plan"
  | "file_created"
  | "command_started"
  | "command_completed"
  | "test_passed"
  | "test_failed"
  | "deploy_started"
  | "deploy_completed"
  | "stripe_created"
  | "x402_listed"
  | "payment_received"
  | "x402_payment"
  | "cost"
  | "error"
  | "done";

export type EmittedEvent = {
  id: string;
  buildId: string;
  seq: number;
  type: BuildEventType;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

type Listener = (event: EmittedEvent) => void;

/**
 * In-process fan-out so the build page streams without polling the database.
 * Single-process by design: the orchestrator and the SSE route share a runtime.
 * Events are always persisted first, so a reconnect replays from the database
 * and nothing is lost if a listener was not attached yet.
 */
const globalForBus = globalThis as unknown as { __afBus?: Map<string, Set<Listener>> };
const bus: Map<string, Set<Listener>> = globalForBus.__afBus ?? new Map();
globalForBus.__afBus = bus;

export function subscribe(buildId: string, listener: Listener): () => void {
  const set = bus.get(buildId) ?? new Set<Listener>();
  set.add(listener);
  bus.set(buildId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.delete(buildId);
  };
}

export async function recordEvent(
  buildId: string,
  type: BuildEventType,
  title: string,
  detail?: string | null,
  metadata?: Record<string, unknown>,
): Promise<EmittedEvent> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${buildEvents.seq}), 0) + 1` })
    .from(buildEvents)
    .where(eq(buildEvents.buildId, buildId));

  const row = {
    id: newEventId(),
    buildId,
    seq: next,
    type,
    title,
    detail: detail ?? null,
    metadata: metadata ?? null,
  };

  await db.insert(buildEvents).values(row);

  const emitted: EmittedEvent = { ...row, createdAt: Date.now() };
  for (const listener of bus.get(buildId) ?? []) {
    try {
      listener(emitted);
    } catch {
      // A broken listener must never fail the build.
    }
  }
  return emitted;
}

export async function listEvents(buildId: string, afterSeq = 0): Promise<EmittedEvent[]> {
  const rows = await db
    .select()
    .from(buildEvents)
    .where(and(eq(buildEvents.buildId, buildId), sql`${buildEvents.seq} > ${afterSeq}`))
    .orderBy(asc(buildEvents.seq));

  return rows.map((r) => ({
    id: r.id,
    buildId: r.buildId,
    seq: r.seq,
    type: r.type as BuildEventType,
    title: r.title,
    detail: r.detail,
    metadata: r.metadata ?? null,
    createdAt: (r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt) * 1000) || Date.now(),
  }));
}
