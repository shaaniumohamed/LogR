import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, zoneTrades } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";
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

/**
 * Loads the account's trades once, for every page.
 *
 * Period is a correctness feature, not a convenience. Real data showed the most
 * recent month's edge running an order of magnitude above the lifetime figure,
 * because earlier losing months drag the average down. A screen that can only
 * show lifetime actively misrepresents how the trader is doing now (docs/20 §3.5).
 */
export async function loadTrades(period: PeriodKey = "all") {
  const session = await auth();
  const userId = session!.user!.id!;
  const account = await getOrCreateAccount(userId);
  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const timeZone = me?.timeZone && me.timeZone !== "UTC" ? me.timeZone : "UTC";

  const rows = await db.select().from(zoneTrades)
    .where(eq(zoneTrades.accountId, account.id))
    .orderBy(desc(zoneTrades.closedAt));

  const all: ZoneTrade[] = rows.map((r) => ({
    id: r.identityHash,
    symbol: r.symbol,
    direction: r.direction as "long" | "short",
    legs: [],
    openedAt: r.openedAt,
    closedAt: r.closedAt,
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

/** Trades from the most recent N days of data, for the recent-vs-lifetime contrast. */
export function recentSlice(all: ZoneTrade[], days = 30): ZoneTrade[] {
  if (!all.length) return [];
  const cutoff = all[0].closedAt.getTime() - days * 86400000;
  return all.filter((t) => t.closedAt.getTime() >= cutoff);
}
