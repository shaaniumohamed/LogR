/**
 * Moving averages and VWAP over candles, as TradingView draws them.
 *
 * Each returns one value per candle (null until there is enough history), so
 * the chart can plot them against the same times. `next*` functions give the
 * value for a candle still forming from the last closed one, which is how the
 * replay updates a line every frame without recomputing the history.
 */

export interface OHLCV { time: number; high: number; low: number; close: number; volume: number }

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential, seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = emaNext(prev, values[i], period); out[i] = prev; }
  return out;
}

export const emaNext = (prev: number, value: number, period: number) => prev + (2 / (period + 1)) * (value - prev);

/**
 * Volume-weighted average price of the typical price (high + low + close) / 3,
 * restarting at each new session (UTC day by default, MT5's day).
 */
export function vwap(c: OHLCV[], sessionOf: (t: number) => number = (t) => Math.floor(t / 86_400)): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  let session = NaN, pv = 0, vol = 0;
  for (let i = 0; i < c.length; i++) {
    const s = sessionOf(c[i].time);
    if (s !== session) { session = s; pv = 0; vol = 0; }
    const w = c[i].volume || 1;
    pv += ((c[i].high + c[i].low + c[i].close) / 3) * w;
    vol += w;
    out[i] = pv / vol;
  }
  return out;
}
