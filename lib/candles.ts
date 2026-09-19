import { and, asc, between, count, eq, max, min, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceBars } from "@/lib/db/schema";
import type { Candle } from "@/lib/core/parse-candles";

/**
 * Broker symbols carry suffixes; price files do not.
 *
 * Exness sells the same gold as XAUUSD, XAUUSDm, XAUUSDc and XAUUSD.raw
 * depending on account type, while every free price source calls it XAUUSD. A
 * trade on XAUUSDm has to find bars stored as XAUUSD or the chart is simply
 * blank, with nothing on screen explaining why.
 *
 * Trimming to the first six alphanumerics handles every instrument this touches:
 * FX pairs and metals are six characters and everything after is the broker's
 * own decoration; shorter tickers (US30, NAS100, USOIL) are left alone.
 */
export function normalizeSymbol(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length > 6 ? s.slice(0, 6) : s;
}

/**
 * How much chart to show around a trade.
 *
 * Context is what makes a review chart worth looking at — a five-minute scalp
 * drawn on six minutes of bars tells you nothing about where price came from,
 * which is the whole question when the setup was a level. But a fixed window is
 * wrong at both ends: four hours is generous around a scalp and invisible around
 * a two-day swing.
 *
 * So the window scales with the trade and then stops. Three times the hold on
 * each side, never less than three hours (enough to see the session build), never
 * more than a day and a half (beyond which M1 stops being the right resolution
 * and the payload stops being small).
 */
export function contextWindow(openedAt: Date, closedAt: Date) {
  const holdMs = Math.max(60_000, closedAt.getTime() - openedAt.getTime());
  const pad = Math.min(Math.max(holdMs * 3, 3 * 3600_000), 36 * 3600_000);
  return { from: new Date(openedAt.getTime() - pad), to: new Date(closedAt.getTime() + pad) };
}

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
