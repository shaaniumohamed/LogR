import type { Position, ZoneTrade } from "./types";
import { round2 } from "./parse-exness";

/**
 * Group positions into zone trades.
 *
 * The trader ladders into a price zone, then scales out. Those legs are one trade
 * in their head, so they must be one row in the journal. Grouping keys on PRICE
 * proximity as well as time, because legs into a zone are by definition close in
 * price — that is a much stronger signal than time alone.
 *
 * Validated on a real export (docs/20 §2): ~2,800 positions collapsed to ~600
 * zone trades at ~4.6 legs each, ~74% layered. The cluster is a real object in
 * the data, not an artefact of the algorithm.
 */
export interface ClusterOptions {
  /**
   * Zone width as a FRACTION OF PRICE, not an absolute amount. Gold moved several
   * hundred dollars across a seven-month sample, so an absolute band silently
   * changes meaning over time.
   */
  bandPct: number;
  /** Max gap between one entry and the next, in minutes. */
  maxGapMinutes: number;
  /** Require the new leg to open before the cluster's last leg has closed. */
  requireOverlap: boolean;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  bandPct: 0.0012, // ~$5 on gold at $4,300
  maxGapMinutes: 20,
  requireOverlap: true,
};

export function clusterPositions(
  positions: Position[],
  opts: Partial<ClusterOptions> = {}
): ZoneTrade[] {
  const o = { ...DEFAULT_CLUSTER_OPTIONS, ...opts };
  const sorted = [...positions].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

  const groups: Position[][] = [];
  let cur: Position[] = [];

  for (const p of sorted) {
    if (cur.length === 0) { cur = [p]; continue; }

    const last = cur[cur.length - 1];
    const sameMarket = p.symbol === last.symbol && p.direction === last.direction;

    const latestOpen = Math.max(...cur.map((c) => c.openedAt.getTime()));
    const gapMin = (p.openedAt.getTime() - latestOpen) / 60000;

    const prices = [...cur.map((c) => c.openPrice), p.openPrice];
    const band = Math.max(...prices) - Math.min(...prices);
    const withinBand = band <= Math.max(...prices) * o.bandPct;

    // A position that goes flat closes the idea; a later re-entry is a new trade.
    const stillOpen = Math.max(...cur.map((c) => c.closedAt.getTime()));
    const overlaps = !o.requireOverlap || p.openedAt.getTime() <= stillOpen;

    if (sameMarket && gapMin <= o.maxGapMinutes && withinBand && overlaps) {
      cur.push(p);
    } else {
      groups.push(cur);
      cur = [p];
    }
  }
  if (cur.length) groups.push(cur);

  return groups.map(toZoneTrade);
}

function toZoneTrade(legs: Position[]): ZoneTrade {
  const lots = legs.reduce((s, l) => s + l.lots, 0);
  const openedAt = new Date(Math.min(...legs.map((l) => l.openedAt.getTime())));
  const closedAt = new Date(Math.max(...legs.map((l) => l.closedAt.getTime())));
  const entries = legs.map((l) => l.openPrice);

  // Volume-weighted, because the ladder's legs are not all the same size.
  const avgEntry = lots > 0 ? legs.reduce((s, l) => s + l.openPrice * l.lots, 0) / lots : 0;
  const avgExit = lots > 0 ? legs.reduce((s, l) => s + l.closePrice * l.lots, 0) / lots : 0;

  const zoneLow = Math.min(...entries);
  const zoneHigh = Math.max(...entries);

  return {
    // Stable across re-imports: keyed on the legs themselves, never a serial id,
    // so user notes and tags survive a full re-derivation (docs/04).
    id: identityHash(legs),
    symbol: legs[0].symbol,
    direction: legs[0].direction,
    legs,
    openedAt,
    closedAt,
    holdMinutes: round2((closedAt.getTime() - openedAt.getTime()) / 60000),
    lots: round2(lots),
    avgEntry: round2(avgEntry),
    avgExit: round2(avgExit),
    zoneLow: round2(zoneLow),
    zoneHigh: round2(zoneHigh),
    zoneHeight: round2(zoneHigh - zoneLow),
    netPnl: round2(legs.reduce((s, l) => s + l.profit + l.commission + l.swap, 0)),
    commission: round2(legs.reduce((s, l) => s + l.commission, 0)),
    swap: round2(legs.reduce((s, l) => s + l.swap, 0)),
    legCount: legs.length,
    closeReasons: [...new Set(legs.map((l) => l.closeReason))],
    hadStop: legs.some((l) => l.stopLoss !== null),
  };
}

/** Deterministic id from the sorted leg tickets. Same legs → same id, always. */
export function identityHash(legs: Position[]): string {
  const key = legs.map((l) => l.ticket).sort().join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}
