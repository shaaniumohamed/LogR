/**
 * The timeframes a chart can show, and where each one's bars come from.
 *
 * Two families, for a reason that is about data and not about presentation.
 *
 * The minute family is rolled up in the browser from the one-minute bars the
 * page already holds, so switching between them costs nothing and shows exactly
 * the window that was loaded. That family cannot reach past an hour: a review
 * window is hours either side of a trade, and a daily candle drawn over it is
 * one candle.
 *
 * The higher family is fetched and stored as its own series. It has to be,
 * because our minute coverage is deliberately patchy — days are fetched when
 * they are needed — and a daily bar built by aggregating a day we only half
 * hold would report a high and a low that never happened. A daily bar from the
 * provider is the day; a daily bar from our minutes is whatever we happen to
 * have. Those are different claims and only one of them is true.
 *
 * It matters because the higher timeframes are where the reason for the trade
 * usually lives. A level read on the daily and executed on the three minute
 * cannot be reviewed on the three minute alone.
 */

export interface HigherTimeframe {
  /** The provider's own interval name, also the stored discriminator. */
  key: string;
  label: string;
  seconds: number;
  /** How much history to read around the trade, in days. */
  loadBefore: number;
  loadAfter: number;
  /** How much of it to show before the reader pans, in days. */
  viewBefore: number;
  viewAfter: number;
}

export const HIGHER_TIMEFRAMES: HigherTimeframe[] = [
  { key: "1h",    label: "1H", seconds: 3_600,   loadBefore: 25,   loadAfter: 5,   viewBefore: 5,    viewAfter: 1 },
  { key: "4h",    label: "4H", seconds: 14_400,  loadBefore: 140,  loadAfter: 20,  viewBefore: 30,   viewAfter: 5 },
  { key: "1day",  label: "1D", seconds: 86_400,  loadBefore: 1100, loadAfter: 90,  viewBefore: 240,  viewAfter: 30 },
  { key: "1week", label: "1W", seconds: 604_800, loadBefore: 4000, loadAfter: 400, viewBefore: 1100, viewAfter: 180 },
];

export const higherTimeframe = (key: string) => HIGHER_TIMEFRAMES.find((t) => t.key === key);
export const HIGHER_KEYS = HIGHER_TIMEFRAMES.map((t) => t.key);

/** Minute timeframes, rolled up from the stored one-minute series. */
export const MINUTE_TIMEFRAMES = [
  { key: 1, label: "1m" }, { key: 3, label: "3m" }, { key: 5, label: "5m" },
  { key: 10, label: "10m" }, { key: 15, label: "15m" }, { key: 30, label: "30m" },
] as const;

export interface BarAlignment {
  /** Fills that fell inside a bar we hold. */
  checked: number;
  inside: number;
  score: number | null;
  /** The same, allowing the fill to sit in either neighbouring bar. */
  lenientInside: number;
  lenientScore: number | null;
}

/**
 * Do these coarse bars describe the market this trader actually transacted in?
 *
 * The one-minute check asks a sharp question — a fill must sit inside the high
 * and low of its own minute — and that question catches a wrong timezone, a
 * wrong instrument and a clock change all at once. It cannot be asked of a
 * daily bar, because a daily range is wide enough to swallow almost anything.
 *
 * So this asks the weaker question that a daily bar can answer honestly: is
 * this even the same instrument, at the same scale? Gold fills do not land
 * inside a currency pair's daily range, and they do not land inside gold
 * futures' either. The lenient score allows the neighbouring bar because
 * providers disagree about which calendar day a late-evening bar belongs to,
 * and being wrong by one daily bar is not evidence of anything.
 */
export function checkBarAlignment(
  bars: { time: number; high: number; low: number }[],
  fills: { time: number; price: number }[],
  barSeconds: number,
): BarAlignment {
  const empty: BarAlignment = { checked: 0, inside: 0, score: null, lenientInside: 0, lenientScore: null };
  if (!bars.length || !fills.length) return empty;

  const byBucket = new Map<number, { high: number; low: number }>();
  for (const b of bars) byBucket.set(Math.floor(b.time / barSeconds), { high: b.high, low: b.low });

  const first = bars[0].time, last = bars[bars.length - 1].time + barSeconds;
  let checked = 0, inside = 0, lenient = 0;

  for (const f of fills) {
    if (f.time < first || f.time >= last) continue;
    const bucket = Math.floor(f.time / barSeconds);
    const own = byBucket.get(bucket);
    if (!own) continue;
    checked++;

    if (f.price >= own.low && f.price <= own.high) { inside++; lenient++; continue; }

    for (const d of [-1, 1]) {
      const n = byBucket.get(bucket + d);
      if (n && f.price >= n.low && f.price <= n.high) { lenient++; break; }
    }
  }

  if (!checked) return empty;
  return {
    checked, inside, lenientInside: lenient,
    score: inside / checked,
    lenientScore: lenient / checked,
  };
}
