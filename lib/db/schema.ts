import {
  boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey,
  real, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ------------------------------------------------------------------ auth.js */
export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  /** Everything in the UI renders in this zone. The export is UTC; the trader is not. */
  timeZone: text("time_zone").notNull().default("UTC"),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull().default("USD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable("account", {
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AdapterAccountType>().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verificationToken", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

/* --------------------------------------------------------------- trading */

export const tradingAccounts = pgTable("trading_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull(),
  broker: text("broker").notNull().default("Exness"),
  platform: text("platform").notNull().default("mt5"),
  login: text("login"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  accountKind: text("account_kind").notNull().default("live"), // live | demo | cent | prop
  /**
   * Cent accounts denominate in cents. Aggregating one with a standard account
   * without normalising is wrong by a factor of 100 (docs/14 §7).
   */
  isCent: boolean("is_cent").notNull().default(false),
  /**
   * 'compounding' or 'working_capital'. On a working-capital account the trader
   * sweeps profits and resets a fixed float, which makes percentage gain and
   * balance drawdown meaningless (docs/16 §5).
   */
  capitalMode: text("capital_mode").notNull().default("compounding"),
  declaredFloat: doublePrecision("declared_float"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("trading_account_user_idx").on(t.userId)]);

/**
 * Immutable raw layer: one closed position exactly as the broker reported it.
 * Everything else is derived from this and can be rebuilt at any time.
 */
export const positions = pgTable("position", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ticket: text("ticket").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  direction: text("direction").notNull(),
  symbol: text("symbol").notNull(),
  lots: real("lots").notNull(),
  openPrice: doublePrecision("open_price").notNull(),
  closePrice: doublePrecision("close_price").notNull(),
  stopLoss: doublePrecision("stop_loss"),
  takeProfit: doublePrecision("take_profit"),
  commission: doublePrecision("commission").notNull().default(0),
  swap: doublePrecision("swap").notNull().default(0),
  profit: doublePrecision("profit").notNull(),
  /** user | tp | sl | so | unknown — the most informative column in the export. */
  closeReason: text("close_reason").notNull().default("unknown"),
  importBatchId: text("import_batch_id"),
}, (t) => [
  /**
   * Idempotency key is (account, ticket, closedAt) — NOT ticket alone.
   *
   * A ticket identifies a position, and a position closed in parts emits one
   * row per partial exit, all sharing that ticket. Keying on ticket alone
   * silently discards real exits: on a real export it dropped six of them and
   * put the stored P&L $39.83 below the broker's own figure.
   *
   * A position cannot close twice at the same instant, so adding closedAt makes
   * the key exact while still making a re-imported overlapping range a no-op.
   */
  uniqueIndex("position_account_ticket_closed_idx").on(t.accountId, t.ticket, t.closedAt),
  index("position_account_opened_idx").on(t.accountId, t.openedAt),
]);

/**
 * Derived layer. Rebuildable from positions, so it carries no user-authored data;
 * notes and tags key to identityHash instead and survive re-derivation.
 */
export const zoneTrades = pgTable("zone_trade", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  identityHash: text("identity_hash").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  holdMinutes: real("hold_minutes").notNull(),
  /** Distinct entry tickets — the ladder's real depth. */
  legCount: integer("leg_count").notNull(),
  /** Close events; exceeds legCount when a position was scaled out of. */
  exitCount: integer("exit_count").notNull().default(1),
  lots: real("lots").notNull(),
  avgEntry: doublePrecision("avg_entry").notNull(),
  avgExit: doublePrecision("avg_exit").notNull(),
  zoneLow: doublePrecision("zone_low").notNull(),
  zoneHigh: doublePrecision("zone_high").notNull(),
  netPnl: doublePrecision("net_pnl").notNull(),
  hadStop: boolean("had_stop").notNull().default(false),
  closeReasons: text("close_reasons").array().notNull().default([]),
}, (t) => [
  uniqueIndex("zone_trade_identity_idx").on(t.accountId, t.identityHash),
  index("zone_trade_account_closed_idx").on(t.accountId, t.closedAt),
]);

/** User-authored. Keyed to identityHash so a rebuild never destroys it. */
export const tradeAnnotations = pgTable("trade_annotation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  identityHash: text("identity_hash").notNull(),
  setup: text("setup"),
  timeframe: text("timeframe"),
  /** The level where the idea was dead. Without it there is no R (docs/09). */
  invalidation: doublePrecision("invalidation"),
  invalidationSource: text("invalidation_source"), // zone_geometry | user | setup_rule
  confluences: text("confluences").array().notNull().default([]),
  mistakes: text("mistakes").array().notNull().default([]),
  emotion: text("emotion"),
  note: text("note"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("annotation_identity_idx").on(t.accountId, t.identityHash)]);

export const importBatches = pgTable("import_batch", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  filename: text("filename"),
  parserVersion: text("parser_version").notNull().default("exness-csv-1"),
  rowsParsed: integer("rows_parsed").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsDuplicate: integer("rows_duplicate").notNull().default(0),
  reportedNet: doublePrecision("reported_net"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
