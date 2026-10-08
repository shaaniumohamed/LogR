import type { BarSeries, TickSeries } from "@/lib/core/market/format";
import { rollup, type Timeframe } from "@/lib/core/market/bars";

/**
 * The candle still forming at the replay clock.
 *
 * Built from whole minutes for the part of the candle before today (a daily
 * candle that started on Sunday evening, or a weekly one), and from the day's
 * own ticks for the rest — up to and including the clock, never past it. It
 * is the same candle a rollup of the minute bars would give once it closes,
 * because the minute bars were built from the same ticks.
 */

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

interface Part { open: number; high: number; low: number; close: number; volume: number; first: number }

/** Minute bars with time in [from, to), as one part (prices as stored integers). */
export function foldBars(b: BarSeries | null, from: number, to: number): Part | null {
  if (!b) return null;
  let i = lowerBound(b.time, from), out: Part | null = null;
  for (; i < b.count && b.time[i] < to; i++) {
    if (!out) out = { open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i], volume: b.volume[i], first: b.time[i] };
    else {
      if (b.high[i] > out.high) out.high = b.high[i];
      if (b.low[i] < out.low) out.low = b.low[i];
      out.close = b.close[i];
      out.volume += b.volume[i];
    }
  }
  return out;
}

/** Ticks with time in [fromMs, toMs] (inclusive of the clock), as one part of bid prices. */
export function foldTicks(t: TickSeries | null, fromMs: number, toMs: number): Part | null {
  if (!t || !t.count) return null;
  const base = t.dayStart * 1000;
  let i = lowerBoundMs(t, fromMs - base), out: Part | null = null;
  for (; i < t.count && t.ms[i] + base <= toMs; i++) {
    const p = t.bid[i];
    if (!out) out = { open: p, high: p, low: p, close: p, volume: 1, first: Math.floor((t.ms[i] + base) / 1000) };
    else {
      if (p > out.high) out.high = p;
      if (p < out.low) out.low = p;
      out.close = p;
      out.volume++;
    }
  }
  return out;
}

/** Two parts in time order as one candle at `key`, prices scaled back by `decimals`. */
export function joinParts(key: number, decimals: number, ...parts: (Part | null)[]): Candle | null {
  const ps = parts.filter((p): p is Part => !!p);
  if (!ps.length) return null;
  const k = 10 ** decimals;
  let high = ps[0].high, low = ps[0].low, volume = 0;
  for (const p of ps) { if (p.high > high) high = p.high; if (p.low < low) low = p.low; volume += p.volume; }
  return { time: key, open: ps[0].open / k, high: high / k, low: low / k, close: ps[ps.length - 1].close / k, volume };
}

/**
 * The closed candles for `tf` built from the minutes in [from, to), epoch
 * seconds. `from` and `to` must be where candles start (`barSpan(...).start`):
 * then the candles for [a, c) are exactly those for [a, b) followed by those
 * for [b, c), which is what lets the replay add only the newest ones.
 */
export function closedBetween(m1: BarSeries | null, tf: Timeframe, from: number, to: number): Candle[] {
  if (!m1 || to <= from) return [];
  const lo = lowerBound(m1.time, from), hi = lowerBound(m1.time, to);
  if (hi <= lo) return [];
  // Views into the minutes, not copies.
  const slice: BarSeries = {
    ...m1, count: hi - lo,
    time: m1.time.subarray(lo, hi), open: m1.open.subarray(lo, hi), high: m1.high.subarray(lo, hi),
    low: m1.low.subarray(lo, hi), close: m1.close.subarray(lo, hi), volume: m1.volume.subarray(lo, hi),
    spreadAvg: m1.spreadAvg.subarray(lo, hi), spreadMax: m1.spreadMax.subarray(lo, hi),
  };
  const s = rollup(slice, tf.seconds, tf.bucket);
  const k = 10 ** s.decimals;
  const out: Candle[] = new Array(s.count);
  for (let i = 0; i < s.count; i++) {
    out[i] = { time: s.time[i], open: s.open[i] / k, high: s.high[i] / k, low: s.low[i] / k, close: s.close[i] / k, volume: s.volume[i] };
  }
  return out;
}

/** Index of the first tick at or after `ms` (milliseconds from the day's start). */
export function lowerBoundMs(t: TickSeries, ms: number): number {
  let lo = 0, hi = t.count;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.ms[mid] < ms) lo = mid + 1; else hi = mid; }
  return lo;
}

function lowerBound(a: Uint32Array, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}
