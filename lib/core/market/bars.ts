import { emptyBars, type BarSeries, type TickSeries } from "./format";

/**
 * Candles from ticks, and bigger candles from smaller ones.
 *
 * One aggregation for everything — the stored M1, H1 and D1 files and every
 * timeframe drawn on screen — so a 15-minute candle built in the browser from
 * M1 is exactly the one that would be built from the ticks, and the 1h candle
 * on the chart is exactly the one in the stored H1 file. If those ever
 * disagreed, a level read on one timeframe would sit in a different place on
 * another, which is the one thing a multi-timeframe trader cannot work with.
 *
 * Candles are bid prices, as MT5 draws them.
 */

/** M1 bars from one day of ticks. */
export function ticksToM1(t: TickSeries): BarSeries {
  // First pass sizes the output: at most one bar per minute that had a tick.
  let bars = 0, lastMin = -1;
  for (let i = 0; i < t.count; i++) {
    const m = Math.floor(t.ms[i] / 60_000);
    if (m !== lastMin) { bars++; lastMin = m; }
  }
  const out = emptyBars(60, t.decimals, bars);
  let k = -1, sum = 0;
  lastMin = -1;
  for (let i = 0; i < t.count; i++) {
    const m = Math.floor(t.ms[i] / 60_000);
    const b = t.bid[i], spread = t.ask[i] - b;
    if (m !== lastMin) {
      if (k >= 0) out.spreadAvg[k] = Math.round(sum / out.volume[k]);
      k++;
      lastMin = m;
      out.time[k] = t.dayStart + m * 60;
      out.open[k] = out.high[k] = out.low[k] = out.close[k] = b;
      out.volume[k] = 0;
      out.spreadMax[k] = spread;
      sum = 0;
    }
    if (b > out.high[k]) out.high[k] = b;
    if (b < out.low[k]) out.low[k] = b;
    out.close[k] = b;
    out.volume[k]++;
    sum += spread;
    if (spread > out.spreadMax[k]) out.spreadMax[k] = spread;
  }
  if (k >= 0) out.spreadAvg[k] = Math.round(sum / out.volume[k]);
  return out;
}

/** Maps a bar's open time (epoch seconds) to the open time of the bigger bar it belongs to. */
export type Bucket = (t: number) => number;

export const fixedBucket = (seconds: number): Bucket => (t) => Math.floor(t / seconds) * seconds;

const DAY = 86_400;
/** 0 = Monday … 6 = Sunday. 1 January 1970 was a Thursday. */
const weekday = (day: number) => (day + 3) % 7;

/**
 * Daily candles.
 *
 * Gold reopens on Sunday evening (UTC). On a UTC-midnight day — what an MT5
 * server on GMT+0 draws — that hour is a candle of its own, and a one-hour
 * "daily" high or low is not a level anybody traded. `sundayIntoMonday` folds
 * it into Monday, as TradingView does; it is the default because daily levels
 * are what MSNR reads, and the raw UTC day remains available.
 */
export const dayBucket = (sundayIntoMonday = true): Bucket => (t) => {
  const day = Math.floor(t / DAY);
  return (sundayIntoMonday && weekday(day) === 6 ? day + 1 : day) * DAY;
};

/** Weekly candles open on Monday; Sunday's evening session belongs to the week ahead. */
export const weekBucket: Bucket = (t) => {
  const day = Math.floor(t / DAY);
  const wd = weekday(day);
  return (wd === 6 ? day + 1 : day - wd) * DAY;
};

/**
 * Roll bars up into bigger ones.
 *
 * Spread is averaged by tick count, so a quiet minute with a wide spread does
 * not count the same as a busy minute with a tight one. `resolution` is
 * recorded on the output for the bucket's nominal size (a week is 604,800 s
 * even though weeks are aligned to Mondays, not to the epoch).
 */
export function rollup(src: BarSeries, resolution: number, bucket: Bucket = fixedBucket(resolution)): BarSeries {
  let n = 0, last = -1;
  for (let i = 0; i < src.count; i++) {
    const b = bucket(src.time[i]);
    if (b !== last) { n++; last = b; }
  }
  const out = emptyBars(resolution, src.decimals, n);
  let k = -1, weighted = 0;
  last = -1;
  for (let i = 0; i < src.count; i++) {
    const b = bucket(src.time[i]);
    if (b !== last) {
      if (k >= 0) out.spreadAvg[k] = out.volume[k] ? Math.round(weighted / out.volume[k]) : 0;
      k++;
      last = b;
      out.time[k] = b;
      out.open[k] = src.open[i];
      out.high[k] = src.high[i];
      out.low[k] = src.low[i];
      out.volume[k] = 0;
      out.spreadMax[k] = 0;
      weighted = 0;
    }
    if (src.high[i] > out.high[k]) out.high[k] = src.high[i];
    if (src.low[i] < out.low[k]) out.low[k] = src.low[i];
    out.close[k] = src.close[i];
    out.volume[k] += src.volume[i];
    weighted += src.spreadAvg[i] * src.volume[i];
    if (src.spreadMax[i] > out.spreadMax[k]) out.spreadMax[k] = src.spreadMax[i];
  }
  if (k >= 0) out.spreadAvg[k] = out.volume[k] ? Math.round(weighted / out.volume[k]) : 0;
  return out;
}

/** Several consecutive series (months, days) as one. They must be in time order and not overlap. */
export function concatBars(parts: BarSeries[]): BarSeries {
  const list = parts.filter((p) => p.count > 0);
  if (!list.length) return emptyBars(parts[0]?.resolution ?? 60, parts[0]?.decimals ?? 3, 0);
  const total = list.reduce((s, p) => s + p.count, 0);
  const out = emptyBars(list[0].resolution, list[0].decimals, total);
  let at = 0;
  let prev = -Infinity;
  for (const p of list) {
    if (p.decimals !== out.decimals || p.resolution !== out.resolution) throw new Error("Cannot join bars of different kinds.");
    if (p.time[0] <= prev) throw new Error("Bar series overlap or are out of order.");
    for (const key of ["time", "open", "high", "low", "close", "volume", "spreadAvg", "spreadMax"] as const) {
      (out[key] as Int32Array | Uint32Array).set(p[key] as Int32Array & Uint32Array, at);
    }
    at += p.count;
    prev = p.time[p.count - 1];
  }
  return out;
}

/* ------------------------------------------------------------- timeframes */

export interface Timeframe {
  key: string;
  label: string;
  /** Nominal seconds per candle. */
  seconds: number;
  /** Which stored resolution it is built from. */
  source: "m1" | "h1" | "d1";
  bucket: Bucket;
}

/**
 * The timeframes a chart offers, smallest first.
 *
 * Every one divides evenly into a UTC day, so candles always start on the
 * hour or at midnight exactly as they do on MT5 with a GMT+0 server: 4h
 * candles open at 00, 04, 08, 12, 16 and 20 UTC.
 */
export function timeframes(opts: { sundayIntoMonday?: boolean } = {}): Timeframe[] {
  const minute = (m: number): Timeframe => ({
    key: `${m}m`, label: `${m}m`, seconds: m * 60, source: "m1", bucket: fixedBucket(m * 60),
  });
  return [
    minute(1), minute(3), minute(5), minute(10), minute(15), minute(30),
    { key: "1h", label: "1h", seconds: 3_600, source: "h1", bucket: fixedBucket(3_600) },
    { key: "4h", label: "4h", seconds: 14_400, source: "h1", bucket: fixedBucket(14_400) },
    { key: "1d", label: "1D", seconds: DAY, source: "d1", bucket: dayBucket(opts.sundayIntoMonday ?? true) },
    { key: "1w", label: "1W", seconds: 7 * DAY, source: "d1", bucket: weekBucket },
  ];
}

/** Candles for one timeframe from bars of its source resolution. */
export function forTimeframe(src: BarSeries, tf: Timeframe): BarSeries {
  return src.resolution === tf.seconds && tf.key !== "1d" ? src : rollup(src, tf.seconds, tf.bucket);
}

/** Plain-number candles for the chart, prices scaled back to decimals. */
export function toCandles(s: BarSeries): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  const k = 10 ** s.decimals;
  const out = new Array(s.count);
  for (let i = 0; i < s.count; i++) {
    out[i] = {
      time: s.time[i], open: s.open[i] / k, high: s.high[i] / k, low: s.low[i] / k, close: s.close[i] / k,
      volume: s.volume[i],
    };
  }
  return out;
}
