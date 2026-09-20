import { and, asc, between, count, eq, max, min, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceBars, priceBarsHtf } from "@/lib/db/schema";
import type { Candle } from "@/lib/core/parse-candles";
import { normalizeSymbol } from "@/lib/core/symbols";
import { closureGapIn, contextWindow, fetchWindow } from "@/lib/core/window";
import { HIGHER_TIMEFRAMES } from "@/lib/core/timeframes";
import { readOrDegrade } from "@/lib/db/schema-check";

// Re-exported so callers have one place to reach for anything candle-shaped.
export { normalizeSymbol, contextWindow, fetchWindow };

/** One-minute bars for a window, oldest first. Aggregation to M5/M15 happens on the client. */
export async function loadBars(symbol: string, from: Date, to: Date): Promise<Candle[]> {
  return readOrDegrade(() => loadBarsUnguarded(symbol, from, to), []);
}

async function loadBarsUnguarded(symbol: string, from: Date, to: Date): Promise<Candle[]> {
  const rows = await db.select().from(priceBars)
    .where(and(eq(priceBars.symbol, normalizeSymbol(symbol)), between(priceBars.t, from, to)))
    .orderBy(asc(priceBars.t));
  return rows.map((r) => ({
    time: Math.floor(r.t.getTime() / 1000),
    open: r.open, high: r.high, low: r.low, close: r.close,
  }));
}

export interface Coverage { symbol: string; bars: number; from: Date; to: Date }

/** What price history exists, for the import screen and the empty states. */
export async function loadCoverage(): Promise<Coverage[]> {
  return readOrDegrade(loadCoverageUnguarded, []);
}

async function loadCoverageUnguarded(): Promise<Coverage[]> {
  const rows = await db
    .select({
      symbol: priceBars.symbol,
      bars: count(),
      from: min(priceBars.t),
      to: max(priceBars.t),
    })
    .from(priceBars)
    .groupBy(priceBars.symbol);
  return rows
    .filter((r): r is Coverage => r.from !== null && r.to !== null)
    .sort((a, b) => b.bars - a.bars);
}

/**
 * Do we hold bars covering this instant?
 *
 * Asked per trade so the review screen can say "no candles for this day" rather
 * than drawing an empty chart. One cheap indexed existence check.
 */
export async function hasBarsAround(symbol: string, at: Date): Promise<boolean> {
  return readOrDegrade(async () => {
  const halfDay = 12 * 3600_000;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(priceBars)
    .where(and(
      eq(priceBars.symbol, normalizeSymbol(symbol)),
      between(priceBars.t, new Date(at.getTime() - halfDay), new Date(at.getTime() + halfDay)),
    ));
  return (row?.n ?? 0) > 0;
  }, false);
}

export interface MissingDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** How many of that day's trades have no candle at the minute they happened. */
  trades: number;
}

/**
 * Which trading days have no price history behind them.
 *
 * Measured per trade rather than per day, because "this day has some bars" is
 * not the question — a day half-filled by a failed fetch would pass that test
 * and still leave charts blank. Asking whether each position has a bar at the
 * minute it opened is exact, and the count it returns is directly meaningful:
 * twelve trades that day cannot be charted.
 */
export async function missingTradingDays(accountId: string, symbol: string): Promise<MissingDay[]> {
  return readOrDegrade(() => missingTradingDaysUnguarded(accountId, symbol), []);
}

async function missingTradingDaysUnguarded(accountId: string, symbol: string): Promise<MissingDay[]> {
  const sym = normalizeSymbol(symbol);
  const dayExpr = sql<string>`to_char(date_trunc('day', ${positions.openedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, trades: sql<number>`count(*)::int` })
    .from(positions)
    .where(and(
      eq(positions.accountId, accountId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${priceBars} b
        WHERE b.symbol = ${sym} AND b.t = date_trunc('minute', ${positions.openedAt})
      )`,
    ))
    // Grouped by output ordinal rather than by repeating the expression: the
    // query builder renders the same column qualified in one place and bare in
    // the other, and matching them is the planner's job to get right, not ours.
    .groupBy(sql`1`)
    .orderBy(sql`1 DESC`);
  return rows;
}

export type { ClosureGap } from "@/lib/core/window";

/**
 * The same measurement, for callers that have not already loaded the bars.
 * Kept thin: the rule itself lives in core, next to the window arithmetic it
 * belongs with, so the trade page can answer this from candles it already has.
 */
export async function closureGap(symbol: string, from: Date, to: Date) {
  const bars = await loadBars(symbol, from, to);
  return closureGapIn(bars, Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000));
}


const DAY_MS = 86_400_000;

/** Bars at one higher timeframe, oldest first. */
export async function loadHtfBars(symbol: string, tf: string, from: Date, to: Date): Promise<Candle[]> {
  return readOrDegrade(async () => {
    const rows = await db.select().from(priceBarsHtf)
      .where(and(
        eq(priceBarsHtf.symbol, normalizeSymbol(symbol)),
        eq(priceBarsHtf.tf, tf),
        between(priceBarsHtf.t, from, to),
      ))
      .orderBy(asc(priceBarsHtf.t));
    return rows.map((r) => ({
      time: Math.floor(r.t.getTime() / 1000),
      open: r.open, high: r.high, low: r.low, close: r.close,
    }));
  }, []);
}

/**
 * Every higher timeframe for one trade, read together.
 *
 * Four statements rather than one, but issued in parallel, so the page waits
 * for a single crossing instead of four. One statement would have meant reading
 * eleven years of daily bars to satisfy the weekly window, which is a lot of
 * rows thrown away to save a query that was not costing anything.
 */
export async function loadHtfAround(symbol: string, openedAt: Date, closedAt: Date) {
  const pairs = await Promise.all(HIGHER_TIMEFRAMES.map(async (tf) => {
    const bars = await loadHtfBars(
      symbol, tf.key,
      new Date(openedAt.getTime() - tf.loadBefore * DAY_MS),
      new Date(closedAt.getTime() + tf.loadAfter * DAY_MS),
    );
    return [tf.key, bars] as const;
  }));
  return Object.fromEntries(pairs) as Record<string, Candle[]>;
}

export interface HtfCoverage { tf: string; bars: number; from: Date; to: Date }

/** What higher-timeframe history exists, for the price-history screen. */
export async function loadHtfCoverage(symbol: string): Promise<HtfCoverage[]> {
  return readOrDegrade(async () => {
    const rows = await db
      .select({ tf: priceBarsHtf.tf, bars: count(), from: min(priceBarsHtf.t), to: max(priceBarsHtf.t) })
      .from(priceBarsHtf)
      .where(eq(priceBarsHtf.symbol, normalizeSymbol(symbol)))
      .groupBy(priceBarsHtf.tf);
    const order = HIGHER_TIMEFRAMES.map((t) => t.key);
    return rows
      .filter((r): r is HtfCoverage => r.from !== null && r.to !== null)
      .sort((a, b) => order.indexOf(a.tf) - order.indexOf(b.tf));
  }, []);
}
