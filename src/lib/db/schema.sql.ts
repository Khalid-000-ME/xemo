/**
 * Schema as plain, idempotent DDL.
 *
 * Applied at server start (see `instrumentation.ts`) rather than through a
 * migration step: one less command to forget, and every statement is
 * `IF NOT EXISTS`, so running it against a database that already has the tables
 * is a harmless no-op. PRAGMAs are deliberately absent — they are connection
 * settings, and a remote libSQL database rejects them.
 */
export const SCHEMA_STATEMENTS: string[] = `
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
`
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);
