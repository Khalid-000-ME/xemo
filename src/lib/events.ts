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

  // The database is the only channel: the invocation that runs a build and the
  // one that streams its timeline are different instances on a serverless
  // platform, so anything held in memory would never reach the reader.
  await db.insert(buildEvents).values(row);

  return { ...row, createdAt: Date.now() };
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
