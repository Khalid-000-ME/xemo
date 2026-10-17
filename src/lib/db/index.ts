import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Schema is applied with plain DDL at first connection rather than a migration
 * step. One less command to get wrong on a clock, and the shape is small enough
 * that `IF NOT EXISTS` is honest.
 */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL DEFAULT 'dashboard',
  prompt TEXT NOT NULL,
  product_name TEXT NOT NULL,
  template TEXT NOT NULL,
  brand_color TEXT NOT NULL DEFAULT 'indigo',
  status TEXT NOT NULL DEFAULT 'queued',
  status_detail TEXT,
  plan TEXT,
  app_url TEXT,
  sandbox_id TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,
  human_price_usd REAL NOT NULL DEFAULT 5,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  stripe_checkout_url TEXT,
  agent_price_usd REAL NOT NULL DEFAULT 0.02,
  agent_endpoint_url TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS builds_status_idx ON builds(status);
CREATE INDEX IF NOT EXISTS builds_created_idx ON builds(created_at);

CREATE TABLE IF NOT EXISTS build_events (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS build_events_build_idx ON build_events(build_id, seq);

CREATE TABLE IF NOT EXISTS generated_files (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'text',
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS generated_files_build_idx ON generated_files(build_id);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  build_id TEXT,
  provider TEXT NOT NULL,
  rail TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'succeeded',
  purpose TEXT NOT NULL,
  external_id TEXT,
  settled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS ledger_build_idx ON ledger(build_id);
CREATE INDEX IF NOT EXISTS ledger_rail_idx ON ledger(rail, direction);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_external_uq
  ON ledger(provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS processed_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  rail TEXT NOT NULL DEFAULT 'human',
  status TEXT NOT NULL DEFAULT 'created',
  input_ref TEXT,
  stripe_session_id TEXT,
  amount_usd REAL NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS orders_build_idx ON orders(build_id);
CREATE INDEX IF NOT EXISTS orders_session_idx ON orders(stripe_session_id);
`;

function open() {
  const path = resolve(process.cwd(), env.databaseUrl);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema });
}

// Next.js dev reloads modules; keep one handle per process.
const globalForDb = globalThis as unknown as { __afDb?: ReturnType<typeof open> };
export const db = globalForDb.__afDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__afDb = db;

export { schema };
