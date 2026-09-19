/**
 * Domain types. This module — and everything in lib/core — must stay free of
 * framework and database imports so it can run in the browser (where statement
 * parsing happens, to sidestep serverless payload limits) and on the server.
 */

/** Why the broker closed the position. Exness reports these verbatim. */
export type CloseReason = "user" | "tp" | "sl" | "so" | "unknown";

/**
 * One CLOSE EVENT, as exported by the broker.
 *
 * Exness exports at position level rather than deal level, so each row is a
 * complete round trip — which removes the MT5 deal-aggregation problem for this
 * broker. But a row is not a position: when a position is closed in parts, the
 * export emits ONE ROW PER PARTIAL EXIT, every one of them carrying the parent
 * position's ticket, with the same open time and open price.
 *
 * So `ticket` is NOT unique. Verified on a real export: five tickets appeared
 * 2–3 times each, identical on entry and differing only on close time, volume
 * and result. Keying storage on ticket alone silently discards real exits and
 * makes the stored P&L disagree with the broker (docs/20 §1).
 *
 * The identity of a row is (ticket, closedAt): a single position cannot close
 * twice at the same instant.
 */
export interface Position {
  ticket: string;
  openedAt: Date;
  closedAt: Date;
  direction: "long" | "short";
  lots: number;
  symbol: string;
  openPrice: number;
  closePrice: number;
  /** null when the trader used no platform stop — the common case. */
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  /** Net profit in account currency, as the broker reports it. Source of truth. */
  profit: number;
  closeReason: CloseReason;
}

/**
 * A group of positions the trader thinks of as one trade: an entry zone laddered
 * into, then scaled out of. Validated against real data at ~4.6 legs per trade
 * with ~74% layered (docs/20 §2).
 */
export interface ZoneTrade {
  id: string;
  symbol: string;
  direction: "long" | "short";
  legs: Position[];
  openedAt: Date;
  closedAt: Date;
  /** Minutes from first entry to last exit. */
  holdMinutes: number;
  lots: number;
  /** Volume-weighted average entry across the ladder. */
  avgEntry: number;
  avgExit: number;
  /** Price span of the entries — the zone the trader laddered into. */
  zoneLow: number;
  zoneHigh: number;
  zoneHeight: number;
  netPnl: number;
  commission: number;
  swap: number;
  /**
   * Distinct entry tickets — the real depth of the ladder.
   * Not the row count, because partial exits repeat their parent's ticket.
   */
  legCount: number;
  /** Close events. Exceeds legCount when positions were scaled out of. */
  exitCount: number;
  closeReasons: CloseReason[];
  /** True when any leg carried a platform stop. */
  hadStop: boolean;
}

export interface Stats {
  n: number;
  net: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  /** avgWin / avgLoss. The number that sets the break-even win rate. */
  payoff: number | null;
  /**
   * The win rate this payoff ratio needs just to break even: 1 / (1 + payoff).
   * The gap between this and winRate is the entire edge — see docs/20 §3.1.
   */
  breakEvenWinRate: number | null;
  /** winRate − breakEvenWinRate, in percentage points. */
  edgePoints: number | null;
  avgHoldMinutes: number;
  totalLots: number;
  expectancy: number;
}
