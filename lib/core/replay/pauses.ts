import type { SimEvent, Side } from "@/lib/core/sim/broker";
import { nextSessionOpen, type MarketSession } from "./clock";

/**
 * Why the replay stopped by itself. Playing fast, the moment that matters —
 * an order filling, a stop or target being hit, a big release, a session
 * opening — would otherwise be gone before the eye caught it.
 */
export type PauseReason =
  | { kind: "fill"; from: "limit" | "stop"; positionId: string; side: Side; lots: number; price: number }
  | { kind: "close"; reason: "sl" | "tp" | "so"; positionId: string; price: number; profit: number }
  | { kind: "news"; at: number; title: string }
  | { kind: "session"; at: number; label: string };

export interface AutoPause {
  /** Pending orders filling. */
  fills: boolean;
  /** Stops, targets and stop-outs. */
  stops: boolean;
  /** Before high-impact releases, `newsLeadSec` ahead. */
  news: boolean;
  newsLeadSec: number;
  /** At the Tokyo, London and New York opens. */
  sessions: boolean;
}

export const DEFAULT_AUTOPAUSE: AutoPause = { fills: true, stops: true, news: false, newsLeadSec: 120, sessions: false };

/** Whether an event from the account should stop the replay. The trader's own actions never do. */
export function pauseForEvent(e: SimEvent, o: AutoPause): PauseReason | null {
  if (e.kind === "fill" && e.from !== "market" && o.fills) {
    return { kind: "fill", from: e.from, positionId: e.positionId, side: e.side, lots: e.lots, price: e.price };
  }
  if (e.kind === "close" && o.stops && (e.reason === "sl" || e.reason === "tp" || e.reason === "so")) {
    return { kind: "close", reason: e.reason, positionId: e.positionId, price: e.price, profit: e.profit };
  }
  return null;
}

export interface NewsPoint { at: number; title: string }

/**
 * The first moment strictly after `afterMs` and no later than `uptoMs` where
 * playing should stop by itself: `leadSec` before a release in `news` (epoch
 * seconds, sorted), or a session open. Null when there is none in range.
 */
export function nextPausePoint(
  afterMs: number, uptoMs: number,
  opts: { news: NewsPoint[]; leadSec: number; sessions: MarketSession[] },
): { at: number; reason: PauseReason } | null {
  let best: { at: number; reason: PauseReason } | null = null;
  const consider = (at: number, reason: PauseReason) => {
    if (at > afterMs && at <= uptoMs && (!best || at < best.at)) best = { at, reason };
  };
  if (opts.news.length) {
    // First release whose pause point is after `afterMs`.
    const want = afterMs / 1000 + opts.leadSec;
    let lo = 0, hi = opts.news.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (opts.news[mid].at <= want) lo = mid + 1; else hi = mid; }
    const n = opts.news[lo];
    if (n) consider((n.at - opts.leadSec) * 1000, { kind: "news", at: n.at, title: n.title });
  }
  for (const s of opts.sessions) {
    const at = nextSessionOpen(s, Math.floor(afterMs / 1000));
    consider(at * 1000, { kind: "session", at, label: s.label });
  }
  return best;
}
