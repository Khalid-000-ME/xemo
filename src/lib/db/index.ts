import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "@/lib/env";
import { SCHEMA_STATEMENTS } from "./schema.sql";
import * as schema from "./schema";

/**
 * One SQLite dialect, two places to run it.
 *
 * Locally `DATABASE_URL` is a file; on Vercel it is a `libsql://` URL, because a
 * serverless filesystem is ephemeral and every invocation can land on a fresh
 * instance. libSQL speaks the same dialect as SQLite, so the schema and every
 * query are identical in both places.
 */
function resolveUrl(): { url: string; remote: boolean } {
  const raw = env.databaseUrl;
  const remote = /^(libsql|https?|wss?):\/\//.test(raw);

  if (remote) return { url: raw, remote: true };

  // A file database on Vercel would "work" and then silently lose every build
  // between invocations. Refuse rather than appear to function.
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is a local file, but this is a Vercel deployment where the filesystem is " +
        "ephemeral. Set DATABASE_URL to a libsql:// URL (and DATABASE_AUTH_TOKEN) — see docs/vercel.md.",
    );
  }

  const path = raw.startsWith("file:")
    ? raw.slice("file:".length)
    : // turbopackIgnore: the db path is runtime configuration, not a traced import.
      resolve(/* turbopackIgnore: true */ process.cwd(), raw);

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return { url: `file:${path}`, remote: false };
}

function open(): { client: Client; db: ReturnType<typeof drizzle<typeof schema>>; remote: boolean } {
  const { url, remote } = resolveUrl();
  const client = createClient({
    url,
    ...(remote ? { authToken: env.databaseAuthToken } : {}),
  });
  return { client, db: drizzle(client, { schema }), remote };
}

// Next.js dev reloads modules; keep one handle per process.
const globalForDb = globalThis as unknown as { __xemoDb?: ReturnType<typeof open> };
const handle = globalForDb.__xemoDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__xemoDb = handle;

export const db = handle.db;
export { schema };

/**
 * Create the tables if they are missing.
 *
 * Runs once per server start from `instrumentation.ts`. A single batch is one
 * round trip to a remote database and atomic, so a cold start never observes a
 * half-built schema.
 */
export async function ensureSchema(): Promise<void> {
  if (!handle.remote) {
    // Connection settings, not schema — valid only on a local file.
    await handle.client.execute("PRAGMA journal_mode = WAL");
    await handle.client.execute("PRAGMA busy_timeout = 5000");
  }
  await handle.client.batch(SCHEMA_STATEMENTS, "write");
}
