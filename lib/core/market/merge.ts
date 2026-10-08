import { emptyBars, type BarSeries, type TickSeries } from "./format";

/**
 * Putting new data together with what is already stored.
 *
 * Imports overlap in two honest ways. A file can start or end partway through
 * a UTC day (the day before it lives in the previous year's file), so that
 * day's ticks arrive in two pieces. And a month or a year file covers far more
 * than one import may hold, so a new import must replace only the days it
 * brings and keep every other day exactly as it was.
 */

/**
 * Two pieces of the same day as one, in time order. A tick present in both
 * — same millisecond, same bid, same ask — is kept once, so importing the same
 * file twice changes nothing.
 */
export function mergeTicks(a: TickSeries, b: TickSeries): TickSeries {
  if (a.dayStart !== b.dayStart || a.decimals !== b.decimals) throw new Error("Cannot merge ticks from different days or scales.");
  const ms = new Int32Array(a.count + b.count), bid = new Int32Array(ms.length), ask = new Int32Array(ms.length);
  let i = 0, j = 0, n = 0;
  const push = (s: TickSeries, k: number) => { ms[n] = s.ms[k]; bid[n] = s.bid[k]; ask[n] = s.ask[k]; n++; };
  while (i < a.count || j < b.count) {
    if (j >= b.count || (i < a.count && a.ms[i] < b.ms[j])) { push(a, i++); continue; }
    if (i >= a.count || b.ms[j] < a.ms[i]) { push(b, j++); continue; }
    // Same millisecond: drop exact duplicates, keep genuinely different ticks.
    if (a.bid[i] === b.bid[j] && a.ask[i] === b.ask[j]) { push(a, i++); j++; }
    else push(a, i++);
  }
  return { dayStart: a.dayStart, decimals: a.decimals, count: n, ms: ms.slice(0, n), bid: bid.slice(0, n), ask: ask.slice(0, n) };
}

const KEYS = ["time", "open", "high", "low", "close", "volume", "spreadAvg", "spreadMax"] as const;

/** The bars for which `keep(time)` is true. */
export function filterBars(s: BarSeries, keep: (time: number) => boolean): BarSeries {
  const idx: number[] = [];
  for (let i = 0; i < s.count; i++) if (keep(s.time[i])) idx.push(i);
  const out = emptyBars(s.resolution, s.decimals, idx.length);
  for (const k of KEYS) {
    const src = s[k] as Int32Array, dst = out[k] as Int32Array;
    for (let n = 0; n < idx.length; n++) dst[n] = src[idx[n]];
  }
  return out;
}

/**
 * Two bar series as one, in time order. Where both have a bar at the same time
 * the incoming one wins — it was built from the newer import.
 */
export function mergeBars(existing: BarSeries, incoming: BarSeries): BarSeries {
  if (existing.resolution !== incoming.resolution || existing.decimals !== incoming.decimals) {
    throw new Error("Cannot merge bars of different kinds.");
  }
  const order: [BarSeries, number][] = [];
  let i = 0, j = 0;
  while (i < existing.count || j < incoming.count) {
    if (j >= incoming.count || (i < existing.count && existing.time[i] < incoming.time[j])) order.push([existing, i++]);
    else if (i >= existing.count || incoming.time[j] < existing.time[i]) order.push([incoming, j++]);
    else { order.push([incoming, j++]); i++; }
  }
  const out = emptyBars(existing.resolution, existing.decimals, order.length);
  order.forEach(([src, k], n) => { for (const key of KEYS) (out[key] as Int32Array)[n] = (src[key] as Int32Array)[k]; });
  return out;
}
