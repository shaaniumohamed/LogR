/**
 * The levels a trader keeps coming back to.
 *
 * Mark-up drawn on one trade is worth something on that trade. Mark-up drawn on
 * forty trades is worth something else entirely, and nothing in a journal
 * normally looks at it: a level trader returns to the SAME price band for weeks,
 * and the question of which of their levels actually pay is answerable only by
 * putting every drawing on one axis and seeing which ones stack up.
 *
 * Deliberately clustered across labels rather than within them. Calling a band
 * demand on Monday and supply on Thursday is not two levels — it is one level
 * that flipped, which in MSNR is the interesting thing about it, and splitting
 * them by name would hide exactly the case worth seeing.
 */

export interface Mark {
  tradeId: string;
  low: number;
  high: number;
  label: string;
  /** What the trade that carried this drawing made. */
  netPnl: number;
  /** When that trade closed, for "first seen" and "last seen". */
  at: Date;
}

export interface Level {
  low: number;
  high: number;
  /** Middle of the band, for sorting and display. */
  mid: number;
  /** Distinct trades that marked this band. A trade marking it twice counts once. */
  trades: number;
  net: number;
  wins: number;
  losses: number;
  /** Every name given to this band, commonest first. A flip shows up as two. */
  labels: { label: string; count: number }[];
  firstSeen: Date;
  lastSeen: Date;
}

/**
 * How far apart two bands can sit and still be the same level.
 *
 * Derived from the prices themselves rather than hard-coded, so this works on
 * gold at 3300 and on a currency pair at 1.08 without knowing which it is
 * looking at. Five parts in ten thousand is about the width of a level a human
 * draws by eye; the median band height is used when the drawings themselves are
 * wider than that.
 */
export function levelTolerance(marks: Mark[]): number {
  if (!marks.length) return 0;
  const mid = marks.reduce((s, m) => s + (m.low + m.high) / 2, 0) / marks.length;
  const heights = marks.map((m) => Math.abs(m.high - m.low)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  return Math.max(Math.abs(mid) * 0.0005, medianHeight * 0.5);
}

export function clusterLevels(marks: Mark[], tolerance?: number): Level[] {
  if (!marks.length) return [];
  const tol = tolerance ?? levelTolerance(marks);

  const sorted = [...marks]
    .map((m) => ({ ...m, low: Math.min(m.low, m.high), high: Math.max(m.low, m.high) }))
    .sort((a, b) => a.low - b.low);

  const groups: (typeof sorted)[] = [];
  let current: typeof sorted = [sorted[0]];
  let reach = sorted[0].high;

  for (let i = 1; i < sorted.length; i++) {
    const m = sorted[i];
    // Overlapping, or close enough that a human would have meant the same line.
    if (m.low <= reach + tol) {
      current.push(m);
      if (m.high > reach) reach = m.high;
    } else {
      groups.push(current);
      current = [m];
      reach = m.high;
    }
  }
  groups.push(current);

  return groups
    .map((g) => {
      // One trade can carry several drawings of the same band; it is still one
      // trade's worth of evidence, and counting it twice would double its result.
      const perTrade = new Map<string, { netPnl: number; at: Date }>();
      const labelCounts = new Map<string, number>();
      for (const m of g) {
        perTrade.set(m.tradeId, { netPnl: m.netPnl, at: m.at });
        labelCounts.set(m.label, (labelCounts.get(m.label) ?? 0) + 1);
      }
      const results = [...perTrade.values()];
      const times = results.map((r) => r.at.getTime());
      const low = Math.min(...g.map((m) => m.low));
      const high = Math.max(...g.map((m) => m.high));

      return {
        low, high, mid: (low + high) / 2,
        trades: results.length,
        net: Math.round(results.reduce((s, r) => s + r.netPnl, 0) * 100) / 100,
        wins: results.filter((r) => r.netPnl > 0).length,
        losses: results.filter((r) => r.netPnl < 0).length,
        labels: [...labelCounts.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
        firstSeen: new Date(Math.min(...times)),
        lastSeen: new Date(Math.max(...times)),
      };
    })
    .sort((a, b) => b.trades - a.trades || Math.abs(b.net) - Math.abs(a.net));
}
