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

/**
 * Something the trader marked on the chart.
 *
 * Two families, because they answer different questions. A LEVEL or a ZONE is
 * a price and nothing else — it runs across the whole chart, at every
 * timeframe, and it is what the Levels view pools across trades ("this band has
 * been traded fifteen times"). A BOX, a TREND line and a NOTE are pinned to
 * particular candles as well, because what they record happened at a moment:
 * the order block that formed at 09:15, the sweep of the Asian low, the candle
 * that was the reason to get in.
 *
 * Every coordinate is a price or a time, never a screen position — a drawing
 * that moved when the chart was zoomed would be worthless. Times are the open
 * time of the candle the point was placed on, in epoch seconds (UTC), so the
 * same note lands on the right candle at the one minute and at the daily.
 */
export type DrawColor = "amber" | "green" | "red" | "blue";

interface DrawingBase {
  /** Stable within one trade; used as a React key and to delete. */
  id: string;
  /** A preset name, free text the trader typed, or — for a note — the note itself. */
  label: string;
  /** Absent on drawings saved before colours existed; they read as amber. */
  color?: DrawColor;
}

/** A horizontal line or band across the whole chart. */
export interface PriceDrawing extends DrawingBase {
  kind: "zone" | "level";
  low: number;
  /** Equal to `low` for a level. */
  high: number;
}

/** Two corners of a box, or the two ends of a trend line. */
export interface AnchoredDrawing extends DrawingBase {
  kind: "box" | "trend";
  t1: number; p1: number;
  t2: number; p2: number;
  /** Carried on to the right edge of the chart: an unmitigated block, a ray. */
  extend?: boolean;
}

/** A written note pinned to one candle at one price. */
export interface NoteDrawing extends DrawingBase {
  kind: "note";
  t1: number; p1: number;
}

export type Drawing = PriceDrawing | AnchoredDrawing | NoteDrawing;
