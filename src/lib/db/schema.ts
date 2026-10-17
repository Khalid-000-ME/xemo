import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/**
 * A build is one attempt by Xemo to create, test, deploy and monetize
 * an app. `origin` records who commissioned it, which is what separates a
 * dashboard-driven build from one an agent paid for over x402.
 */
export const builds = sqliteTable(
  "builds",
  {
    id: text("id").primaryKey(),
    origin: text("origin").notNull().default("dashboard"), // dashboard | x402 | mcp
    prompt: text("prompt").notNull(),
    productName: text("product_name").notNull(),
    template: text("template").notNull(),
    brandColor: text("brand_color").notNull().default("indigo"),
    status: text("status").notNull().default("queued"),
    // queued | planning | generating | testing | deploying | monetizing | live | failed
    statusDetail: text("status_detail"),
    plan: text("plan", { mode: "json" }).$type<unknown>(),

    appUrl: text("app_url"),
    sandboxId: text("sandbox_id"),

    // Human rail (Stripe)
    humanPriceUsd: real("human_price_usd").notNull().default(5),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id"),
    stripeCheckoutUrl: text("stripe_checkout_url"),

    // Agent rail (x402) — the generated app sells to agents too.
    agentPriceUsd: real("agent_price_usd").notNull().default(0.02),
    agentEndpointUrl: text("agent_endpoint_url"),

    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(now),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("builds_status_idx").on(t.status), index("builds_created_idx").on(t.createdAt)],
);

/** Append-only agent timeline. Drives the live build view. */
export const buildEvents = sqliteTable(
  "build_events",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    // plan | file_created | command_started | command_completed | test_passed |
    // test_failed | deploy_started | deploy_completed | stripe_created |
    // x402_listed | payment_received | x402_payment | cost | error | done
    title: text("title").notNull(),
    detail: text("detail"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("build_events_build_idx").on(t.buildId, t.seq)],
);

export const generatedFiles = sqliteTable(
  "generated_files",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id").notNull(),
    path: text("path").notNull(),
    content: text("content").notNull(),
    language: text("language").notNull().default("text"),
    bytes: integer("bytes").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("generated_files_build_idx").on(t.buildId)],
);

/**
 * One ledger for every money movement, in both directions and on both rails.
 * This table is the product's actual claim: revenue and cost in one place.
 */
export const ledger = sqliteTable(
  "ledger",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id"),
    provider: text("provider").notNull(), // stripe | x402 | paybox | createos
    rail: text("rail").notNull(), // human | agent | compute | supplier
    direction: text("direction").notNull(), // inflow | outflow
    amountUsd: real("amount_usd").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("succeeded"), // pending | succeeded | failed | refunded
    purpose: text("purpose").notNull(),
    // commission | app_purchase | agent_api_call | llm_inference | sandbox_compute | pdf_parse
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("ledger_build_idx").on(t.buildId),
    index("ledger_rail_idx").on(t.rail, t.direction),
    // Idempotency: one row per external payment id per provider.
    index("ledger_external_uq").on(t.provider, t.externalId),
  ],
);

/** Processed webhook / payment ids, so replays are no-ops. */
export const processedEvents = sqliteTable("processed_events", {
  id: text("id").primaryKey(), // `${provider}:${externalId}`
  provider: text("provider").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

/** Orders placed against a generated app (human rail). */
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id").notNull(),
    rail: text("rail").notNull().default("human"), // human | agent
    status: text("status").notNull().default("created"),
    // created | paid | fulfilling | complete | failed
    inputRef: text("input_ref"),
    stripeSessionId: text("stripe_session_id"),
    amountUsd: real("amount_usd").notNull().default(0),
    result: text("result", { mode: "json" }).$type<unknown>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("orders_build_idx").on(t.buildId), index("orders_session_idx").on(t.stripeSessionId)],
);

export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;
export type BuildEvent = typeof buildEvents.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
export type Order = typeof orders.$inferSelect;
