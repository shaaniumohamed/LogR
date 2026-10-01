import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, zoneTrades } from "@/lib/db/schema";
import { clusterPositions } from "@/lib/core/cluster";
import type { Position } from "@/lib/core/types";

const CHUNK = 500;

/**
 * Rebuild the trades an account's fills add up to.
 *
 * The positions table is what the broker said; zone_trade is what it means —
 * fills layered into one zone, collapsed into the single trade the trader
 * actually took. That derived layer is disposable by design, which is what
 * makes this safe to run after anything that changes the fills underneath it:
 * an import, or an import being taken back.
 *
 * The trader's own writing is not touched. Annotations, screenshots and rules
 * key to identityHash, which is computed from the fills themselves — so a note
 * survives a rebuild, and finds its trade again even after the trade was
 * deleted and re-imported.
 *
 * It rebuilds from EVERY position on the account rather than patching the rows
 * that changed, because clustering is not local: removing one fill can change
 * which zone its neighbours belong to. Patching would leave a trade that no set
 * of fills supports, and nothing would ever say so.
 */
export async function rebuildZoneTrades(
  accountId: string,
  userId: string,
): Promise<{ positions: number; zoneTrades: number }> {
  const all = await db.select().from(positions).where(eq(positions.accountId, accountId));
  const domain: Position[] = all.map((p) => ({
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
    closeReason: p.closeReason as Position["closeReason"],
  }));
  const zones = clusterPositions(domain);

  await db.delete(zoneTrades).where(eq(zoneTrades.accountId, accountId));
  for (let i = 0; i < zones.length; i += CHUNK) {
    await db.insert(zoneTrades).values(
      zones.slice(i, i + CHUNK).map((z) => ({
        accountId,
        userId,
        identityHash: z.id,
        symbol: z.symbol,
        direction: z.direction,
        openedAt: z.openedAt,
        closedAt: z.closedAt,
        holdMinutes: z.holdMinutes,
        legCount: z.legCount,
        exitCount: z.exitCount,
        lots: z.lots,
        avgEntry: z.avgEntry,
        avgExit: z.avgExit,
        zoneLow: z.zoneLow,
        zoneHigh: z.zoneHigh,
        netPnl: z.netPnl,
        hadStop: z.hadStop,
        closeReasons: z.closeReasons,
      }))
    ).onConflictDoNothing();
  }
  return { positions: all.length, zoneTrades: zones.length };
}
