/**
 * How far a trade went against you, and how far for you, while it was open.
 *
 * The final result is one number at one moment. The trade lived through every
 * minute before it — and for a trader with no fixed stop, who ladders into a
 * zone, takes partials and moves the runner to break-even, the path is most of
 * the story: how much heat a winner had to survive, how much a loser was up
 * before it turned, how much of the best moment was actually kept.
 *
 * Measured with the position you ACTUALLY held at each minute, not as if the
 * whole size had been on from the first fill. A ladder of four entries is one
 * small position for its first minutes and a large one only once the zone has
 * filled; partials taken out are banked and stop moving with price. Treating
 * the final size as if it were on throughout would put heat on the first leg
 * that the trader never carried.
 *
 * ── The one thing a minute bar cannot say ──
 *
 * The order of prices inside the minute. In the minute you entered, the bar's
 * low may have printed BEFORE your fill; in the minute you exited, its high may
 * have printed after. Counting the whole bar in those minutes would invent heat
 * and room that never happened while you were in. So in the entry minute only
 * the prices between your fill and the bar's close are used, and in the exit
 * minute only those between the bar's open and your exit — every one of them
 * certainly traded while the position was open.
 *
 * That makes both figures FLOORS: the true heat was at least this much, and the
 * true best was at least this good. Never more than happened.
 */

export interface Bar {
  /** Epoch seconds at the start of the minute. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Leg {
  openedAt: Date;
  closedAt: Date;
  lots: number;
  openPrice: number;
  closePrice: number;
  direction: "long" | "short";
  /** What the broker paid out for this leg. */
  profit: number;
}

export interface ExcursionPoint {
  time: number;
  /** Running result at the worst price this minute, banked legs included. */
  lo: number;
  /** Running result at the best price this minute. */
  hi: number;
}

export interface Excursion {
  /** The deepest the running result went, at least. Never above zero. */
  heat: number;
  /** The highest it went, at least. Never below zero. */
  best: number;
  /** What it finished at. */
  final: number;
  heatAt: number;
  bestAt: number;
  /** Price distance against, and for, the FIRST entry — the trader's own read of the level. */
  adversePrice: number;
  favourablePrice: number;
  /** Share of the trade's minutes there were bars for. */
  coverage: number;
  path: ExcursionPoint[];
}

/** Below this share of minutes, the path is mostly missing and says nothing honest. */
const MIN_COVERAGE = 0.8;

const minuteOf = (d: Date) => Math.floor(d.getTime() / 60_000) * 60;

export function excursion(legs: Leg[], bars: Bar[], pointValue: number): Excursion | null {
  if (!legs.length || !(pointValue > 0)) return null;
  const dir = legs[0].direction === "long" ? 1 : -1;

  const sorted = [...legs].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const first = sorted[0];
  const start = minuteOf(first.openedAt);
  const end = Math.max(...legs.map((l) => minuteOf(l.closedAt)));

  const byMinute = new Map<number, Bar>();
  for (const b of bars) if (b.time >= start && b.time <= end) byMinute.set(b.time, b);

  // The minutes that pin the measurement down have to be there, and most of the
  // rest. A path stitched from a quarter of its minutes is a guess.
  const total = (end - start) / 60 + 1;
  if (!byMinute.has(start) || !byMinute.has(end)) return null;
  const coverage = byMinute.size / total;
  if (coverage < MIN_COVERAGE) return null;

  let heat = Infinity, best = -Infinity, heatAt = start, bestAt = start;
  let lowest = Infinity, highest = -Infinity;
  const path: ExcursionPoint[] = [];

  for (let m = start; m <= end; m += 60) {
    const bar = byMinute.get(m);
    if (!bar) continue;

    let banked = 0, lo = 0, hi = 0, open = 0;
    for (const l of sorted) {
      const lOpen = minuteOf(l.openedAt), lClose = minuteOf(l.closedAt);
      if (lClose < m) { banked += l.profit; continue; }   // closed before this minute began
      if (lOpen > m) continue;                             // not yet entered

      // The prices this leg certainly lived through inside this minute.
      let a: number, b: number;
      if (lOpen === m && lClose === m) { a = l.openPrice; b = l.closePrice; }
      else if (lOpen === m) { a = l.openPrice; b = bar.close; }
      else if (lClose === m) { a = bar.open; b = l.closePrice; }
      else { a = bar.low; b = bar.high; }
      const low = Math.min(a, b), high = Math.max(a, b);

      const worstPrice = dir === 1 ? low : high;
      const bestPrice = dir === 1 ? high : low;
      lo += (worstPrice - l.openPrice) * dir * l.lots * pointValue;
      hi += (bestPrice - l.openPrice) * dir * l.lots * pointValue;
      lowest = Math.min(lowest, low);
      highest = Math.max(highest, high);
      open++;
    }
    if (!open) continue;

    const runLo = banked + lo, runHi = banked + hi;
    path.push({ time: m, lo: runLo, hi: runHi });
    if (runLo < heat) { heat = runLo; heatAt = m; }
    if (runHi > best) { best = runHi; bestAt = m; }
  }
  if (!path.length) return null;

  const final = legs.reduce((s, l) => s + l.profit, 0);
  const adverse = dir === 1 ? first.openPrice - lowest : highest - first.openPrice;
  const favourable = dir === 1 ? highest - first.openPrice : first.openPrice - lowest;

  return {
    heat: Math.min(0, heat, final),
    best: Math.max(0, best, final),
    final,
    heatAt, bestAt,
    adversePrice: Math.max(0, adverse),
    favourablePrice: Math.max(0, favourable),
    coverage,
    path,
  };
}

/** How much of the best moment was kept, for a trade that had one. */
export function keptShare(x: Excursion): number | null {
  return x.best > 0 ? x.final / x.best : null;
}

/**
 * Comebacks by how far price went against the first entry.
 *
 * The question a trader with no fixed stop actually needs answered: once a
 * trade has gone THIS far against me, how often does it still finish green?
 * Bucketed by quantile rather than fixed distances, so the edges sit where this
 * trader's trades actually fall instead of where a gold price happened to be
 * the year the code was written.
 */
export interface ComebackRow { from: number; to: number; n: number; green: number; net: number }

export function comebacks(items: { adversePrice: number; final: number }[], buckets = 5): ComebackRow[] {
  if (items.length < buckets * 6) return [];
  const sorted = [...items].sort((a, b) => a.adversePrice - b.adversePrice);
  const rows: ComebackRow[] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = sorted.slice(Math.floor((i * sorted.length) / buckets), Math.floor(((i + 1) * sorted.length) / buckets));
    if (!slice.length) continue;
    rows.push({
      from: slice[0].adversePrice,
      to: slice[slice.length - 1].adversePrice,
      n: slice.length,
      green: slice.filter((x) => x.final > 0).length,
      net: slice.reduce((s, x) => s + x.final, 0),
    });
  }
  return rows;
}
