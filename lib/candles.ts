import { and, asc, between, count, eq, max, min, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceBars } from "@/lib/db/schema";
import type { Candle } from "@/lib/core/parse-candles";
import { normalizeSymbol } from "@/lib/core/symbols";
import { contextWindow, fetchWindow } from "@/lib/core/window";

// Re-exported so callers have one place to reach for anything candle-shaped.
export { normalizeSymbol, contextWindow, fetchWindow };

/** One-minute bars for a window, oldest first. Aggregation to M5/M15 happens on the client. */
export async function loadBars(symbol: string, from: Date, to: Date): Promise<Candle[]> {
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
  const halfDay = 12 * 3600_000;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(priceBars)
    .where(and(
      eq(priceBars.symbol, normalizeSymbol(symbol)),
      between(priceBars.t, new Date(at.getTime() - halfDay), new Date(at.getTime() + halfDay)),
    ));
  return (row?.n ?? 0) > 0;
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
