import { and, asc, between, count, eq, max, min, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceBars } from "@/lib/db/schema";
import type { Candle } from "@/lib/core/parse-candles";
import { normalizeSymbol } from "@/lib/core/symbols";
import { contextWindow, fetchWindow } from "@/lib/core/window";
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

export interface ClosureGap {
  /** Last price before the market shut, and first price after it reopened. */
  before: number;
  after: number;
  /** after − before, signed, in points. */
  points: number;
  hoursShut: number;
  shutAt: Date;
  reopenedAt: Date;
}

/**
 * How far price moved while the market was shut.
 *
 * Found from the bars themselves — the longest stretch with no data inside the
 * window — rather than from a calendar of session hours, which differ by broker
 * and move with daylight saving. Only ever called for a trade already known to
 * have spanned a weekend, so the longest silence is the closure and not a hole
 * in what has been imported.
 */
export async function closureGap(symbol: string, from: Date, to: Date): Promise<ClosureGap | null> {
  const bars = await loadBars(symbol, from, to);
  if (bars.length < 2) return null;

  let widest = 0, at = -1;
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap > widest) { widest = gap; at = i; }
  }
  // Six hours. Long enough that no quiet patch of a 23-hour market reaches it,
  // short enough to catch a closure shortened by a holiday.
  if (at < 1 || widest < 6 * 3600) return null;

  const before = bars[at - 1].close, after = bars[at].open;
  return {
    before, after,
    points: after - before,
    hoursShut: widest / 3600,
    shutAt: new Date(bars[at - 1].time * 1000),
    reopenedAt: new Date(bars[at].time * 1000),
  };
}
