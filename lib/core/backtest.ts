import type { SimSettings } from "@/lib/core/sim/broker";
import { GOLD_DEFAULTS } from "@/lib/core/sim/broker";
import { computeStats } from "@/lib/core/metrics";
import { toZoneTrade } from "@/lib/core/cluster";
import type { Position, Stats, ZoneTrade } from "@/lib/core/types";

/**
 * Shapes shared by the backtest's screens, its saved rows and its stats.
 */

export type BtSettings = SimSettings;

export const DEFAULT_BT_SETTINGS: BtSettings = { ...GOLD_DEFAULTS };

export interface IndicatorSpec {
  id: string;
  kind: "ema" | "sma" | "vwap";
  /** Candles averaged (not used by VWAP). */
  period: number;
  color: string;
}

/** A Long/Short Position drawing tied to the order it placed (see lib/chart/linked-position.ts). */
export interface BtLink {
  orderId: string;
  ideaId: string;
  side: "buy" | "sell";
  /** The drawing was deleted while the trade was open; undo brings it back. */
  detached?: boolean;
  /** The trade closed: the drawing stays, unlinked and locked, as a record. */
  frozen?: boolean;
}

export interface BtChartPrefs {
  type: "candles" | "line";
  volume: boolean;
  sessions: boolean;
  news: "off" | "high" | "medium";
  indicators: IndicatorSpec[];
  /** The ask line: the price a buy fills at. */
  askLine: boolean;
  /** Time left on the current candle, on the price axis. */
  countdown: boolean;
  /** Dotted lines from each finished trade's entry to its exit. */
  tradePaths: boolean;
  /** Position drawings tied to their orders, by drawing id. */
  links?: Record<string, BtLink>;
}

export const DEFAULT_CHART: BtChartPrefs = {
  type: "candles",
  volume: true,
  sessions: true,
  news: "high",
  askLine: true,
  countdown: true,
  tradePaths: true,
  indicators: [
    { id: "ema20", kind: "ema", period: 20, color: "#2962ff" },
    { id: "ema50", kind: "ema", period: 50, color: "#ff9800" },
  ],
};

/** A finished backtest trade as stored: one row of bt_trade with its legs. */
export interface BtTradeRow {
  id: string;
  ideaId: string;
  direction: "long" | "short";
  openedAt: Date;
  closedAt: Date;
  lots: number;
  avgEntry: number;
  avgExit: number;
  pnl: number;
  risk: number | null;
  r: number | null;
  legs: Position[];
  closeReasons: string[];
}

export interface BtStats extends Stats {
  /** Trades measured in R (those with a stop on every leg). */
  rCount: number;
  avgR: number | null;
  /** Total R, the curve a strategy is judged on. */
  sumR: number;
  maxDrawdown: number;
  maxDrawdownR: number | null;
  longestLosingStreak: number;
  equity: { t: number; pnl: number }[];
}

/** The journal's own trade shape, so its stats code measures backtests unchanged. */
export function asZoneTrade(t: BtTradeRow): ZoneTrade {
  return { ...toZoneTrade(t.legs), id: t.id };
}

export function backtestStats(trades: BtTradeRow[]): BtStats {
  const sorted = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const base = computeStats(sorted.filter((t) => t.legs.length).map(asZoneTrade));
  const rs = sorted.map((t) => t.r).filter((r): r is number => r !== null);
  let peak = 0, run = 0, dd = 0, peakR = 0, runR = 0, ddR = 0, losing = 0, longest = 0;
  const equity: { t: number; pnl: number }[] = [];
  for (const t of sorted) {
    run += t.pnl;
    peak = Math.max(peak, run);
    dd = Math.max(dd, peak - run);
    if (t.r !== null) { runR += t.r; peakR = Math.max(peakR, runR); ddR = Math.max(ddR, peakR - runR); }
    losing = t.pnl < 0 ? losing + 1 : 0;
    longest = Math.max(longest, losing);
    equity.push({ t: Math.floor(t.closedAt.getTime() / 1000), pnl: Math.round(run * 100) / 100 });
  }
  return {
    ...base,
    rCount: rs.length,
    avgR: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 : null,
    sumR: Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100,
    maxDrawdown: Math.round(dd * 100) / 100,
    maxDrawdownR: rs.length ? Math.round(ddR * 100) / 100 : null,
    longestLosingStreak: longest,
    equity,
  };
}
