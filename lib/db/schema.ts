import {
  boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey,
  real, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Drawing } from "@/lib/core/types";

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
  /**
   * What the trader drew on the chart: the zones and levels that made them take
   * the trade. JSONB rather than columns because the shapes are open-ended — a
   * demand zone, a liquidity level and a fib retracement are all just a price
   * band with a name, and a table per shape would be four tables holding the
   * same two numbers. See Drawing in lib/core/types.ts for the shape.
   */
  drawings: jsonb("drawings").$type<Drawing[]>(),
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

/**
 * Market price history: one-minute bars.
 *
 * DELIBERATELY NOT PER-USER. A gold bar at 14:32 UTC is the same bar for
 * everybody; keying it to a user would store the same candle once per trader
 * for no gain, and there is nothing private in it — it is public market data,
 * unlike the fills in `position`. One trader importing a month covers the rest.
 *
 * Only M1 is stored. M5, M15 and H1 are rolled up on read (aggregate() in
 * lib/core/parse-candles.ts), which costs microseconds and saves storing the
 * same information four times.
 *
 * Size: XAUUSD trades about 23 hours a day, five days a week, so a year is
 * roughly 360,000 bars. At ~110 bytes a row including the primary-key index
 * that is about 40 MB a year — around a decade of gold inside Neon's free 0.5 GB
 * alongside the trade data, which is well past the point where a paid tier is
 * an easy decision.
 */
export const priceBars = pgTable("price_bar", {
  symbol: text("symbol").notNull(),
  /** Bar OPEN time, UTC, always aligned to the minute. */
  t: timestamp("t", { withTimezone: true }).notNull(),
  /**
   * doublePrecision, matching every other price in this schema. float4 would
   * halve the footprint and gold's tick is far coarser than its precision, but a
   * second float width in the same database is a trap for anyone later comparing
   * a bar to a fill, and the saving is ~6 MB a year against a 500 MB budget.
   */
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  /** Where it came from, so a bad import can be identified and replaced. */
  source: text("source").notNull().default("csv"),
}, (t) => [
  // (symbol, t) is both the identity and exactly the order a window query wants:
  // WHERE symbol = ? AND t BETWEEN ? AND ? reads one contiguous run of the index.
  primaryKey({ columns: [t.symbol, t.t] }),
]);

/**
 * Higher-timeframe bars: hourly, four-hourly, daily and weekly.
 *
 * SEPARATE FROM price_bar, and not a `tf` column added to it, for a reason
 * about truth rather than convenience. Our one-minute coverage is deliberately
 * partial — days are fetched when a trade needs them — so a daily candle built
 * by rolling up a day we only half hold would publish a high and a low that
 * never happened. These rows are fetched AS daily and weekly bars from the
 * provider, so they are the day and the week. Mixing two kinds of claim under
 * one discriminator would invite someone to aggregate across them, and the
 * result would look perfectly plausible and be wrong.
 *
 * They are also tiny and reach far. One call returns five thousand bars, which
 * at four hours is over two years and at a day is thirteen — so four calls give
 * every trade in the account its higher-timeframe context, permanently, against
 * an allowance of eight hundred a day.
 *
 * Shared across accounts for the same reason price_bar is: a daily gold candle
 * is the same candle for everybody, and there is nothing private in it.
 */
export const priceBarsHtf = pgTable("price_bar_htf", {
  symbol: text("symbol").notNull(),
  /** The provider's own interval name: 1h, 4h, 1day, 1week. */
  tf: text("tf").notNull(),
  /** Bar OPEN time, UTC. */
  t: timestamp("t", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  source: text("source").notNull().default("twelvedata"),
}, (t) => [
  // Same shape as price_bar's key and for the same reason: a window query for
  // one symbol at one timeframe reads a single contiguous run of the index.
  primaryKey({ columns: [t.symbol, t.tf, t.t] }),
]);

/**
 * Who is allowed in, beyond the owners named in the environment.
 *
 * Access used to live entirely in an ALLOWED_EMAILS environment variable, which
 * meant adding a friend was: open the host's dashboard, find the variable, edit
 * a comma-separated string without breaking it, redeploy, wait. That is a
 * deployment to let somebody look at a chart, and it is the kind of friction
 * that ends with the variable cleared and the journal open to the internet.
 *
 * The email is the key, lowercased by the code that writes it, because that is
 * exactly the uniqueness wanted: one row per person, and inviting the same
 * address twice is a no-op rather than a duplicate.
 *
 * Revoking removes the row and nothing else. Their trades, notes and mark-up
 * stay exactly where they are — a fallen-out-with friend is not a reason to
 * destroy a year of someone's journal, and re-inviting them restores access
 * without restoring anything from a backup.
 */
export const invites = pgTable("invite", {
  email: text("email").primaryKey(),
  /** Null once the inviter's own row is gone; the invite itself survives. */
  invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
  /** Free text so a list of addresses is still readable in six months. */
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * A screenshot of the chart as the trader saw it.
 *
 * The one input the broker's export can never contain. Everything else in this
 * journal is reconstructed after the fact — where price went, where the fills
 * landed — and none of it shows the thing that actually decided the trade: the
 * chart that was on the screen, with whatever was drawn on it, at the moment
 * the button was pressed. That picture is the evidence; the rest is the record.
 *
 * Only the KEY is stored. The bytes live in object storage, and the link to
 * them is signed fresh on every render and expires within the hour, so a row
 * here is worthless to anyone who gets hold of it.
 *
 * Keyed to identityHash like every other user-authored thing, so re-deriving
 * zone trades after a parser change cannot orphan a screenshot.
 */
export const tradeScreenshots = pgTable("trade_screenshot", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  identityHash: text("identity_hash").notNull(),
  /** Path inside the bucket. Never a URL: those are signed per request. */
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  /** "H4 before entry", "what I saw at 09:15" — a picture with no label ages badly. */
  caption: text("caption"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("screenshot_trade_idx").on(t.accountId, t.identityHash)]);

/**
 * What the trader concluded about a whole week.
 *
 * Three fields rather than one box, because an empty box gets an empty answer.
 * Naming the three questions — what worked, what did not, what to do about it —
 * is most of what makes a weekly review happen at all, and it makes the answers
 * comparable from one week to the next, which a paragraph never is.
 *
 * Keyed by the Monday of the week in the TRADER'S zone, so a week here is the
 * week they lived rather than the one UTC happened to be in.
 */
export const weeklyNotes = pgTable("weekly_note", {
  accountId: text("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** YYYY-MM-DD of the Monday. A date string, because it is a label not an instant. */
  weekStart: text("week_start").notNull(),
  wentWell: text("went_well"),
  toFix: text("to_fix"),
  /** One line. The whole point of the review is that something changes. */
  focus: text("focus"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.accountId, t.weekStart] })]);
