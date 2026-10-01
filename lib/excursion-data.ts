import { unstable_cache } from "next/cache";
import { loadBars } from "@/lib/candles";
import { excursion } from "@/lib/core/excursion";
import { pointValuePerLot } from "@/lib/core/metrics";
import { MARKET_TAG, accountTrades, loadTradesWithLegsBetween, tradesTag, withinPeriod, type PeriodKey } from "@/lib/queries";

export interface TradeExcursion {
  id: string;
  heat: number;
  best: number;
  final: number;
  adversePrice: number;
}

/** The most recent trades measured. Enough for a stable picture, bounded so the read stays small. */
const LIMIT = 300;
const DAY_MS = 86_400_000;

/**
 * Heat and room for the most recent trades that have charts, cached.
 *
 * Measuring a trade needs its fills and the minute bars it lived through, and
 * across hundreds of trades that is a few tens of thousands of bars — worth
 * reading once, not on every visit. The answer changes only when trades are
 * imported or price history arrives, and it is tagged with exactly those.
 *
 * Bounded to the latest few hundred trades in the period, which for a trader
 * at this pace is about a month: recent enough to describe how they trade now,
 * and large enough that the comeback rates are not a handful of trades each.
 */
export function cachedExcursions(accountId: string, period: PeriodKey): Promise<TradeExcursion[]> {
  return unstable_cache(
    async () => {
      const all = await accountTrades(accountId);
      const pv = pointValuePerLot(all);
      const recent = withinPeriod(all, period).slice(0, LIMIT);
      if (!pv || !recent.length) return [];

      // Newest first, so the span runs from the last element to the first.
      const from = new Date(recent[recent.length - 1].openedAt.getTime() - DAY_MS);
      const to = new Date(recent[0].closedAt.getTime() + DAY_MS);
      const symbol = recent[0].symbol;

      const [withLegs, bars] = await Promise.all([
        loadTradesWithLegsBetween(accountId, from, to),
        loadBars(symbol, from, to),
      ]);
      if (!bars.length) return [];

      const wanted = new Set(recent.map((t) => t.id));
      const out: TradeExcursion[] = [];
      for (const t of withLegs) {
        if (!wanted.has(t.id) || t.symbol !== symbol) continue;
        const x = excursion(t.legs, bars, pv);
        if (x) out.push({ id: t.id, heat: x.heat, best: x.best, final: x.final, adversePrice: x.adversePrice });
      }
      return out;
    },
    ["excursions", accountId, period],
    { tags: [tradesTag(accountId), MARKET_TAG], revalidate: 3600 },
  )();
}
