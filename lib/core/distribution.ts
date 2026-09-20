import { round2 } from "./parse-exness";

/**
 * The shape of a trader's results, not just their average.
 *
 * This matters more here than in most journals because of how this account is
 * traded: no platform stop, invalidation held in the head. The headline metric
 * — the win rate a payoff ratio needs to break even — is built from an AVERAGE
 * win and an AVERAGE loss, and an average is exactly the statistic that cannot
 * see a tail. Ninety-eight small losses and two catastrophic ones average out to
 * something that looks survivable and is not.
 *
 * So this bins every result and reports what lives in the ends. The question it
 * answers is the one a mental stop raises and nothing else in the app does: when
 * it goes wrong, how wrong does it go, and how often.
 */

export interface Bin {
  /** Inclusive lower edge, exclusive upper — except the outermost, which are open. */
  from: number;
  to: number;
  count: number;
  total: number;
  /** True for the two collecting bins at the extremes. */
  overflow: boolean;
}

export interface Distribution {
  bins: Bin[];
  binWidth: number;
  median: number;
  mean: number;
  /** The worst 5% of results, and what they came to. */
  tailCount: number;
  tailTotal: number;
  tailAt: number;
  /** What those worst few cost against everything the winners made. */
  tailShareOfGross: number | null;
  /** The best 5%, for the same question in the other direction. */
  topCount: number;
  topTotal: number;
}

/** 1, 2, 2.5, 5, 10 × a power of ten — the widths a reader can do arithmetic with. */
function niceWidth(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (raw <= step * mag) return step * mag;
  }
  return 10 * mag;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
};

/**
 * `targetBins` is a shape, not a promise: the width is snapped to a round number
 * afterwards, so the count that comes back is near it rather than equal to it.
 *
 * The core range is set from the 2nd and 98th percentiles rather than from the
 * extremes. A single trade four hundred times the size of a typical one would
 * otherwise set the scale and squash every real bar into the middle column,
 * which is the usual way a histogram of trading results ends up saying nothing.
 * The outliers are not discarded — they are collected into the end bins and
 * counted there, which is where the interesting part of this distribution is.
 */
export function distribution(values: number[], targetBins = 13): Distribution | null {
  if (values.length < 20) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const lo = quantile(sorted, 0.02);
  const hi = quantile(sorted, 0.98);
  const span = Math.max(hi - lo, 1e-9);
  const width = niceWidth(span / targetBins);

  /*
   * Zero is always a bin EDGE, never inside a bin.
   *
   * A bin spanning −$2 to +$3 would report five trades without saying whether
   * they made money, which on a chart of wins against losses is the one thing
   * it must never do.
   */
  const firstEdge = Math.floor(lo / width) * width;
  const lastEdge = Math.ceil(hi / width) * width;

  const edges: number[] = [];
  for (let e = firstEdge; e <= lastEdge + width / 2; e += width) edges.push(round2(e));

  const bins: Bin[] = [
    { from: -Infinity, to: edges[0], count: 0, total: 0, overflow: true },
    ...edges.slice(0, -1).map((from, i) => ({
      from, to: edges[i + 1], count: 0, total: 0, overflow: false,
    })),
    { from: edges[edges.length - 1], to: Infinity, count: 0, total: 0, overflow: true },
  ];

  for (const v of values) {
    let idx = bins.findIndex((b) => v >= b.from && v < b.to);
    // The very top value equals the last finite edge and belongs in the overflow.
    if (idx === -1) idx = bins.length - 1;
    bins[idx].count += 1;
    bins[idx].total = round2(bins[idx].total + v);
  }

  const tailN = Math.max(1, Math.round(values.length * 0.05));
  const worst = sorted.slice(0, tailN);
  const best = sorted.slice(-tailN);
  const grossProfit = values.filter((v) => v > 0).reduce((s, v) => s + v, 0);

  const mid = sorted.length / 2;
  return {
    bins,
    binWidth: width,
    median: round2(sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2),
    mean: round2(values.reduce((s, v) => s + v, 0) / values.length),
    tailCount: tailN,
    tailTotal: round2(worst.reduce((s, v) => s + v, 0)),
    tailAt: round2(worst[worst.length - 1]),
    // Left unrounded: this is a ratio the caller formats as a percentage, and
    // rounding it to two decimals here would quantise it to whole percent.
    tailShareOfGross: grossProfit > 0
      ? Math.abs(worst.reduce((s, v) => s + v, 0)) / grossProfit
      : null,
    topCount: tailN,
    topTotal: round2(best.reduce((s, v) => s + v, 0)),
  };
}
