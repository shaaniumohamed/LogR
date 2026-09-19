import type { Position, Stats, ZoneTrade } from "./types";
import { round2 } from "./parse-exness";

type Scorable = { netPnl: number; holdMinutes: number; lots: number };

const toScorable = (t: ZoneTrade | Position): Scorable =>
  "netPnl" in t
    ? { netPnl: t.netPnl, holdMinutes: t.holdMinutes, lots: t.lots }
    : {
        netPnl: t.profit + t.commission + t.swap,
        holdMinutes: (t.closedAt.getTime() - t.openedAt.getTime()) / 60000,
        lots: t.lots,
      };

/**
 * Scratch threshold. Trades this close to zero are counted in the total but kept
 * out of the win-rate numerator AND denominator, and the count is always shown —
 * undisclosed scratch handling is how a journal gets accused of lying.
 */
export const SCRATCH = 0.005;

export function computeStats(input: (ZoneTrade | Position)[]): Stats {
  const items = input.map(toScorable);
  const n = items.length;
  if (n === 0) {
    return {
      n: 0, net: 0, wins: 0, losses: 0, scratches: 0, winRate: 0,
      grossProfit: 0, grossLoss: 0, profitFactor: null, avgWin: 0, avgLoss: 0,
      payoff: null, breakEvenWinRate: null, edgePoints: null,
      avgHoldMinutes: 0, totalLots: 0, expectancy: 0,
    };
  }

  const wins = items.filter((t) => t.netPnl > SCRATCH);
  const losses = items.filter((t) => t.netPnl < -SCRATCH);
  const scratches = n - wins.length - losses.length;

  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const decided = wins.length + losses.length;

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const payoff = avgLoss > 0 && avgWin > 0 ? avgWin / avgLoss : null;
  const winRate = decided ? wins.length / decided : 0;

  // THE number. A 57% win rate is excellent at a 1.5 payoff and break-even at 0.77.
  const breakEvenWinRate = payoff !== null ? 1 / (1 + payoff) : null;

  return {
    n,
    net: round2(items.reduce((s, t) => s + t.netPnl, 0)),
    wins: wins.length,
    losses: losses.length,
    scratches,
    winRate,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    payoff,
    breakEvenWinRate,
    edgePoints: breakEvenWinRate !== null ? (winRate - breakEvenWinRate) * 100 : null,
    avgHoldMinutes: round2(items.reduce((s, t) => s + t.holdMinutes, 0) / n),
    totalLots: round2(items.reduce((s, t) => s + t.lots, 0)),
    expectancy: round2(items.reduce((s, t) => s + t.netPnl, 0) / n),
  };
}

/** Group by any key, keeping buckets below minN out of the results entirely. */
export function segmentBy<T extends ZoneTrade | Position>(
  items: T[],
  keyFn: (t: T) => string | null,
  minN = 8
): { key: string; items: T[]; stats: Stats }[] {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const k = keyFn(t);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()]
    .filter(([, v]) => v.length >= minN)
    .map(([key, v]) => ({ key, items: v, stats: computeStats(v) }))
    .sort((a, b) => b.stats.expectancy - a.stats.expectancy);
}

/**
 * Spread cost, estimated from volume.
 *
 * IMPORTANT FRAMING (docs/16 §0): the spread is inside the fill price, so
 * reported net profit is ALREADY net of it. This is not a hidden deduction —
 * it is the hurdle each trade cleared. Report it as a share of GROSS EDGE
 * (net + spread), never as a share of net profit.
 */
export function spreadCost(totalLots: number, spreadPerOz: number, contractSize = 100) {
  return round2(totalLots * contractSize * spreadPerOz);
}

export function costPicture(net: number, totalLots: number, lo = 0.15, hi = 0.3) {
  const costLo = spreadCost(totalLots, lo);
  const costHi = spreadCost(totalLots, hi);
  return {
    costLo,
    costHi,
    grossLo: round2(net + costLo),
    grossHi: round2(net + costHi),
    /** Share of gross edge kept by the trader, at each end of the range. */
    keptLo: net + costHi > 0 ? net / (net + costHi) : null,
    keptHi: net + costLo > 0 ? net / (net + costLo) : null,
  };
}

/** Local-time hour. The export is UTC; a trader acts in their own timezone. */
export function hourIn(date: Date, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(date);
  return Number(s);
}

export function localDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}
