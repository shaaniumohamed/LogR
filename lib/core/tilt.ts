import type { ZoneTrade } from "./types";
import { localDayKey } from "./metrics";
import { round2 } from "./parse-exness";

/**
 * What you do immediately after a loss, compared with what you do after a win.
 *
 * The most valuable thing a journal can tell a trader about their own head, and
 * the one that needs nothing written down. Revenge trading and tilt are not
 * feelings you have to remember and tag honestly a week later — they are
 * behaviours, and behaviours leave marks in the broker's own export. Re-entering
 * faster than usual, with more size than usual, immediately after losing money
 * is what tilt looks like from the outside, and both halves of that are
 * timestamps and volumes the broker already reported.
 *
 * Three groups rather than two, because the response to a small loss and the
 * response to a bad one are different things and averaging them hides the case
 * that matters.
 */

export interface NextTradeProfile {
  /** How many trades had a next trade to measure. */
  n: number;
  /** Minutes from this trade closing to the next one opening. Median. */
  gapMinutes: number;
  /** Size of the next trade. Median, because one big outlier is not a habit. */
  lots: number;
  /** What the next trade made, on average. */
  result: number;
  winRate: number;
}

export interface TiltReport {
  afterWin: NextTradeProfile;
  afterLoss: NextTradeProfile;
  /** The worst tenth of losses, where a reaction is most likely. */
  afterBigLoss: NextTradeProfile;
  /** A loss worse than this counted as a big one. */
  bigLossAt: number;
  /** Median size across everything, as the line the others are read against. */
  typicalLots: number;
  /** Median gap across everything. */
  typicalGapMinutes: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

const empty: NextTradeProfile = { n: 0, gapMinutes: 0, lots: 0, result: 0, winRate: 0 };

function profile(rows: { gap: number; lots: number; result: number }[]): NextTradeProfile {
  if (!rows.length) return empty;
  const decided = rows.filter((r) => r.result !== 0);
  return {
    n: rows.length,
    gapMinutes: round2(median(rows.map((r) => r.gap))),
    lots: round2(median(rows.map((r) => r.lots))),
    result: round2(rows.reduce((s, r) => s + r.result, 0) / rows.length),
    winRate: decided.length ? decided.filter((r) => r.result > 0).length / decided.length : 0,
  };
}

/**
 * `minPerGroup` guards the whole thing. A difference built on four trades after
 * a big loss is a story, not a finding, and this returns null rather than
 * letting a page print one.
 */
export function tiltProfile(
  trades: ZoneTrade[],
  timeZone: string,
  minPerGroup = 8,
): TiltReport | null {
  if (trades.length < minPerGroup * 3) return null;

  // Sorted by when each trade OPENED, so "the next trade" means the next one
  // entered, which is the decision being measured.
  const byOpen = [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const opens = byOpen.map((t) => t.openedAt.getTime());

  const losses = trades.filter((t) => t.netPnl < 0).map((t) => t.netPnl).sort((a, b) => a - b);
  // Worst tenth, but never fewer than a handful, so the group can exist at all.
  const bigLossAt = losses.length
    ? losses[Math.min(losses.length - 1, Math.max(4, Math.floor(losses.length * 0.1)) - 1)]
    : 0;

  const afterWin: { gap: number; lots: number; result: number }[] = [];
  const afterLoss: typeof afterWin = [];
  const afterBig: typeof afterWin = [];
  const allGaps: number[] = [];

  for (const t of trades) {
    const closed = t.closedAt.getTime();

    // First trade opened strictly after this one closed. Binary search, because
    // a hundred orders a day over seven months makes a linear scan per trade a
    // few million comparisons for no reason.
    let lo = 0, hi = opens.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (opens[mid] > closed) hi = mid; else lo = mid + 1;
    }
    const next = byOpen[lo];
    if (!next) continue;

    /*
     * Same local day only.
     *
     * The gap to the first trade of the next morning measures when the market
     * opened, not how the trader reacted — and including it would put a
     * fourteen-hour outlier in the middle of a measurement whose whole point is
     * minutes. Tilt is a thing that happens inside a session.
     */
    if (localDayKey(next.openedAt, timeZone) !== localDayKey(t.closedAt, timeZone)) continue;

    const row = {
      gap: (next.openedAt.getTime() - closed) / 60_000,
      lots: next.lots,
      result: next.netPnl,
    };
    allGaps.push(row.gap);

    if (t.netPnl > 0) afterWin.push(row);
    else if (t.netPnl < 0) {
      afterLoss.push(row);
      if (t.netPnl <= bigLossAt) afterBig.push(row);
    }
  }

  if (afterWin.length < minPerGroup || afterLoss.length < minPerGroup) return null;

  return {
    afterWin: profile(afterWin),
    afterLoss: profile(afterLoss),
    afterBigLoss: afterBig.length >= minPerGroup ? profile(afterBig) : empty,
    bigLossAt: round2(bigLossAt),
    typicalLots: round2(median(trades.map((t) => t.lots))),
    typicalGapMinutes: round2(median(allGaps)),
  };
}
