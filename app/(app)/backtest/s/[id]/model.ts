import type { BtChartPrefs, BtSettings, BtTradeRow } from "@/lib/core/backtest";
import type { ClosedIdea, SimState } from "@/lib/core/sim/broker";
import type { Drawing } from "lightweight-charts-drawing";

/** Everything the workspace needs about a session, in plain values the server can hand to the browser. */
export interface SessionProps {
  id: string;
  name: string;
  symbol: string;
  strategy: { id: string; name: string };
  startedAt: number;
  clockAt: number;
  timeframe: string;
  chart: BtChartPrefs;
  settings: BtSettings;
  state: SimState | null;
  eventSeq: number;
  version: number;
  drawings: Drawing[];
  drawingTimes: Record<string, number>;
  range: { first: string; last: string } | null;
}

/** A trade as the browser holds it: dates as epoch milliseconds. */
export interface TradeProps extends Omit<BtTradeRow, "openedAt" | "closedAt" | "legs"> {
  openedAt: number;
  closedAt: number;
  legs: (Omit<BtTradeRow["legs"][number], "openedAt" | "closedAt"> & { openedAt: number; closedAt: number })[];
}

export const toRow = (t: TradeProps): BtTradeRow => ({
  ...t, openedAt: new Date(t.openedAt), closedAt: new Date(t.closedAt),
  legs: t.legs.map((l) => ({ ...l, openedAt: new Date(l.openedAt), closedAt: new Date(l.closedAt) })),
});

export const fromRow = (t: BtTradeRow): TradeProps => ({
  ...t, openedAt: t.openedAt.getTime(), closedAt: t.closedAt.getTime(),
  legs: t.legs.map((l) => ({ ...l, openedAt: l.openedAt.getTime(), closedAt: l.closedAt.getTime() })),
});

/** A trade the simulated account just finished, in the stored shape. */
export function ideaToTrade(i: ClosedIdea): TradeProps {
  const lots = i.legs.reduce((a, l) => a + l.lots, 0);
  const avg = (f: (l: ClosedIdea["legs"][number]) => number) => i.legs.reduce((a, l) => a + f(l) * l.lots, 0) / lots;
  return {
    id: i.id, ideaId: i.id, direction: i.side === "buy" ? "long" : "short",
    openedAt: i.openedAt, closedAt: i.closedAt, lots: Math.round(lots * 100) / 100,
    avgEntry: avg((l) => l.openPrice), avgExit: avg((l) => l.closePrice),
    pnl: i.pnl, risk: i.risk, r: i.r, closeReasons: [...new Set(i.legs.map((l) => l.closeReason))],
    legs: i.legs.map((l) => ({
      ticket: l.ticket, openedAt: l.openedAt, closedAt: l.closedAt, direction: l.direction, lots: l.lots, symbol: l.symbol,
      openPrice: l.openPrice, closePrice: l.closePrice, stopLoss: l.stopLoss, takeProfit: l.takeProfit,
      commission: l.commission, swap: l.swap, profit: l.profit, closeReason: l.closeReason,
    })),
  };
}
