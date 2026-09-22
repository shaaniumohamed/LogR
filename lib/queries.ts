import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, zoneTrades } from "@/lib/db/schema";
import { requireContext } from "@/lib/session";
import { clusterPositions } from "@/lib/core/cluster";
import type { ZoneTrade } from "@/lib/core/types";

export const PERIODS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function resolvePeriod(raw?: string): PeriodKey {
  return PERIODS.some((p) => p.key === raw) ? (raw as PeriodKey) : "all";
}

/** Everything derived from an account's trades hangs off this one tag. */
export const tradesTag = (accountId: string) => `trades:${accountId}`;

/**
 * Dates do not survive a cache round trip, so the wire form carries epoch
 * milliseconds and they are rebuilt on the way out. Getting this wrong is the
 * classic failure with a serialising cache: the objects come back looking right
 * and then every `.getTime()` throws.
 */
type Wire = Omit<ZoneTrade, "legs" | "openedAt" | "closedAt"> & { openedAt: number; closedAt: number };

/**
 * The account's trades, cached between requests and invalidated by import.
 *
 * Worth doing because of the shape of the deployment: reading these rows is a
 * round trip from the Vercel function to Neon, which on a bad day is most of
 * the time the reader spends waiting, and the answer only changes when a CSV is
 * imported. Keyed by account id and tagged, so an import clears exactly the one
 * account's copy and nothing else.
 *
 * The one-hour ceiling is a backstop: even if a tag were ever missed, the app
 * cannot serve yesterday's trades all day.
 */
async function cachedTrades(accountId: string): Promise<Wire[]> {
  return unstable_cache(
    async () => {
      const rows = await db.select().from(zoneTrades)
        .where(eq(zoneTrades.accountId, accountId))
        .orderBy(desc(zoneTrades.closedAt));

      return rows.map((r): Wire => ({
        id: r.identityHash,
        symbol: r.symbol,
        direction: r.direction as "long" | "short",
        openedAt: r.openedAt.getTime(),
        closedAt: r.closedAt.getTime(),
        holdMinutes: r.holdMinutes,
        lots: r.lots,
        avgEntry: r.avgEntry,
        avgExit: r.avgExit,
        zoneLow: r.zoneLow,
        zoneHigh: r.zoneHigh,
        zoneHeight: r.zoneHigh - r.zoneLow,
        netPnl: r.netPnl,
        commission: 0,
        swap: 0,
        legCount: r.legCount,
        exitCount: r.exitCount,
        closeReasons: r.closeReasons as ZoneTrade["closeReasons"],
        hadStop: r.hadStop,
      }));
    },
    ["zone-trades", accountId],
    { tags: [tradesTag(accountId)], revalidate: 3600 },
  )();
}

/**
 * Loads the account's trades once, for every page.
 *
 * Period is a correctness feature, not a convenience. Real data showed the most
 * recent month's edge running an order of magnitude above the lifetime figure,
 * because earlier losing months drag the average down. A screen that can only
 * show lifetime actively misrepresents how the trader is doing now (docs/20 §3.5).
 */
export async function loadTrades(period: PeriodKey = "all") {
  const { userId, account, timeZone } = await requireContext();
  const wire = await cachedTrades(account.id);

  const all: ZoneTrade[] = wire.map((w) => ({
    ...w,
    legs: [],
    openedAt: new Date(w.openedAt),
    closedAt: new Date(w.closedAt),
  }));

  const days = PERIODS.find((p) => p.key === period)!.days;
  let trades = all;
  if (days !== null && all.length) {
    // Relative to the newest trade, not to today — an imported history that ends
    // last month would otherwise show an empty "30 days" and look broken.
    const newest = all[0].closedAt.getTime();
    const cutoff = newest - days * 86400000;
    trades = all.filter((t) => t.closedAt.getTime() >= cutoff);
  }

  return {
    userId,
    account,
    /** Everything held, ignoring the period filter. */
    all,
    /** Filtered to the selected period. */
    trades,
    timeZone,
    isEmpty: all.length === 0,
  };
}

/**
 * Individual close events.
 *
 * A close reason describes one exit, not a whole trade: ladder into a zone, take
 * two partials by hand and let the runner hit the stop, and the trade is neither
 * "you closed it" nor "stopped out". Analysing exits avoids having to pick one
 * label for something that had three endings.
 */
export async function loadExits(accountId: string, period: PeriodKey = "all") {
  const rows = await db.select().from(positions)
    .where(eq(positions.accountId, accountId))
    .orderBy(desc(positions.closedAt));
  const days = PERIODS.find((p) => p.key === period)!.days;
  if (days === null || !rows.length) return rows;
  const cutoff = rows[0].closedAt.getTime() - days * 86400000;
  return rows.filter((r) => r.closedAt.getTime() >= cutoff);
}

/** Trades from the most recent N days of data, for the recent-vs-lifetime contrast. */
export function recentSlice(all: ZoneTrade[], days = 30): ZoneTrade[] {
  if (!all.length) return [];
  const cutoff = all[0].closedAt.getTime() - days * 86400000;
  return all.filter((t) => t.closedAt.getTime() >= cutoff);
}

const toDomain = (rows: (typeof positions.$inferSelect)[]) =>
  rows.map((p) => ({
    ticket: p.ticket,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    direction: p.direction as "long" | "short",
    symbol: p.symbol,
    lots: p.lots,
    openPrice: p.openPrice,
    closePrice: p.closePrice,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    commission: p.commission,
    swap: p.swap,
    profit: p.profit,
    closeReason: p.closeReason as "user" | "tp" | "sl" | "so" | "unknown",
  }));

/**
 * One zone trade with its individual fills.
 *
 * Legs are re-derived rather than stored: the zone trade table holds the
 * aggregate, and clustering from raw positions guarantees the legs shown are
 * exactly the ones the aggregate was built from.
 *
 * The window is the point of this function's shape. It used to read EVERY
 * position on the account — on a hundred-orders-a-day account that is tens of
 * thousands of rows dragged across the wire and clustered in full, to display
 * about five of them. It can be a window because a cluster's own boundaries say
 * so: `openedAt` is the earliest leg's open and `closedAt` the latest leg's
 * close, so every leg of this trade opened inside that span. Clustering is a
 * left-to-right sweep whose decisions depend only on the cluster being built, so
 * starting the sweep exactly at this trade's first leg reproduces the same
 * grouping the full pass produced.
 *
 * The full read stays as a fallback. The argument above holds, but it holds
 * because of an invariant in another module, and if that ever changes the right
 * outcome is a slow page rather than a trade that cannot be opened.
 */
export async function loadTradeWithLegs(accountId: string, identityHash: string) {
  const [meta] = await db
    .select({ openedAt: zoneTrades.openedAt, closedAt: zoneTrades.closedAt })
    .from(zoneTrades)
    .where(and(eq(zoneTrades.accountId, accountId), eq(zoneTrades.identityHash, identityHash)))
    .limit(1);

  if (meta) {
    const windowed = await db.select().from(positions)
      .where(and(
        eq(positions.accountId, accountId),
        gte(positions.openedAt, meta.openedAt),
        lte(positions.openedAt, meta.closedAt),
      ))
      .orderBy(asc(positions.openedAt), asc(positions.ticket));

    const hit = clusterPositions(toDomain(windowed)).find((z) => z.id === identityHash);
    if (hit) return hit;
  }

  const rows = await db.select().from(positions).where(eq(positions.accountId, accountId));
  return clusterPositions(toDomain(rows)).find((z) => z.id === identityHash) ?? null;
}

/**
 * How many trades sit under each account.
 *
 * One grouped statement rather than one per account: the settings page lists
 * every account a person has, and asking separately would turn a page that
 * shows two accounts into a page that makes two crossings to say so.
 */
export async function countTradesPerAccount(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await db
    .select({ accountId: zoneTrades.accountId, n: sql<number>`count(*)::int` })
    .from(zoneTrades)
    .where(inArray(zoneTrades.accountId, ids))
    .groupBy(zoneTrades.accountId);
  return Object.fromEntries(rows.map((r) => [r.accountId, r.n]));
}
