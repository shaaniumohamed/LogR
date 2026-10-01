import type { DrawColor, Drawing } from "./types";

/**
 * Everything about chart mark-up that is arithmetic rather than pixels.
 *
 * Kept apart from the chart component so it can be tested, and so the server
 * that stores drawings and the browser that draws them agree on one definition
 * of what a valid drawing is.
 */

export const DRAW_COLORS: DrawColor[] = ["amber", "green", "red", "blue"];

/** The design token each colour is drawn with, so every theme recolours mark-up too. */
export const colorToken = (c: DrawColor | undefined): string =>
  ({ amber: "--c2", green: "--profit", red: "--loss", blue: "--c1" })[c ?? "amber"];

/**
 * The price band a drawing covers, or null if it does not mark one.
 *
 * Used by everything that treats mark-up as levels — the Levels view that pools
 * bands across trades, the trade list's "traded this band" filter. A box is a
 * band that also has a start and an end; a trend line slopes, and a note is a
 * point with words, so neither says "price matters here" in a way that could
 * be pooled.
 */
export function drawingBand(d: Drawing): { low: number; high: number } | null {
  switch (d.kind) {
    case "zone": case "level": return { low: Math.min(d.low, d.high), high: Math.max(d.low, d.high) };
    case "box": return { low: Math.min(d.p1, d.p2), high: Math.max(d.p1, d.p2) };
    default: return null;
  }
}

/** A one-line description for lists: the prices, and the time where there is one. */
export function drawingPrices(d: Drawing, decimals = 2): string {
  const f = (n: number) => n.toFixed(decimals);
  switch (d.kind) {
    case "level": return f(d.low);
    case "zone": return `${f(Math.min(d.low, d.high))} – ${f(Math.max(d.low, d.high))}`;
    case "box": return `${f(Math.min(d.p1, d.p2))} – ${f(Math.max(d.p1, d.p2))}`;
    case "trend": return `${f(d.p1)} → ${f(d.p2)}`;
    case "note": return f(d.p1);
  }
}

export const LABEL_MAX = 40;
export const NOTE_MAX = 140;
export const DRAWINGS_MAX = 60;

/**
 * What the server will store, from whatever the browser sent.
 *
 * The browser is not trusted to send well-formed shapes: anything malformed is
 * dropped rather than stored, because a single drawing with a NaN in it would
 * break the chart for that trade on every later visit. Times must fall between
 * 2000 and a year from now — a wild time is a bug, not a drawing.
 */
export function cleanDrawings(input: unknown, now = Date.now()): Drawing[] {
  if (!Array.isArray(input)) return [];
  const minT = 946_684_800; // 2000-01-01
  const maxT = Math.floor(now / 1000) + 366 * 86_400;
  const price = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const time = (v: unknown) =>
    (typeof v === "number" && Number.isInteger(v) && v >= minT && v <= maxT ? v : null);
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const color = (v: unknown): DrawColor | undefined =>
    (DRAW_COLORS as unknown[]).includes(v) ? (v as DrawColor) : undefined;

  const out: Drawing[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (out.length >= DRAWINGS_MAX) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 40);
    if (!id || seen.has(id)) continue;
    const base = { id, color: color(r.color) };

    if (r.kind === "zone" || r.kind === "level") {
      const low = price(r.low), high = price(r.high);
      if (low === null || high === null) continue;
      out.push({ ...base, kind: r.kind, low: Math.min(low, high), high: r.kind === "level" ? Math.min(low, high) : Math.max(low, high), label: text(r.label, LABEL_MAX) });
    } else if (r.kind === "box" || r.kind === "trend") {
      const t1 = time(r.t1), t2 = time(r.t2), p1 = price(r.p1), p2 = price(r.p2);
      if (t1 === null || t2 === null || p1 === null || p2 === null) continue;
      out.push({ ...base, kind: r.kind, t1, p1, t2, p2, extend: r.extend === true || undefined, label: text(r.label, LABEL_MAX) });
    } else if (r.kind === "note") {
      const t1 = time(r.t1), p1 = price(r.p1);
      if (t1 === null || p1 === null) continue;
      const label = text(r.label, NOTE_MAX);
      if (!label) continue; // a note with nothing written is not a note
      out.push({ ...base, kind: "note", t1, p1, label });
    } else {
      continue;
    }
    seen.add(id);
  }
  // Undefined optional keys are dropped so stored JSON stays as small as the shape.
  return out.map((d) => JSON.parse(JSON.stringify(d)) as Drawing);
}

/*
 * Time ↔ position along the chart.
 *
 * The chart lays candles out by index, not by time, so weekends and gaps take
 * no room. A drawing stores times, so it can be shown at any timeframe; these
 * turn a time into a (fractional) candle index for whatever candles are on
 * screen, and back.
 *
 * A time maps to the candle that contains it, plus how far through that candle
 * it falls. A note placed on the 09:07 one-minute candle therefore sits a little
 * right of centre on the 09:00 fifteen-minute candle — inside the candle it
 * belongs to, which is the property that matters. Times beyond either end of
 * the loaded candles are extended at one candle per bucket, which is what lets
 * a line drawn on the daily still be drawn when only today is loaded.
 */

/** Index of the last candle opening at or before t, or -1. `times` is ascending. */
function floorIndex(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function timeToIndex(times: number[], bucket: number, t: number): number {
  const n = times.length;
  if (!n) return 0;
  if (t < times[0]) return (t - times[0]) / bucket;
  const i = floorIndex(times, t);
  const frac = (t - times[i]) / bucket;
  // Inside a gap (a weekend, a halt) the point waits at the next candle rather
  // than floating over candles that belong to a different time.
  return i < n - 1 ? i + Math.min(frac, 1) : i + frac;
}

/** The open time of the candle at a (rounded) index, extending past either end. */
export function indexToTime(times: number[], bucket: number, index: number): number {
  const n = times.length;
  const i = Math.round(index);
  if (!n) return 0;
  if (i < 0) return times[0] + i * bucket;
  if (i >= n) return times[n - 1] + (i - (n - 1)) * bucket;
  return times[i];
}

/**
 * Pull a tapped price onto the candle's open, high, low or close if it is close.
 *
 * Fingers are about ten pixels wide; a level meant to sit on a candle's close
 * should land on the close, not two cents under it. MSNR reads levels off
 * bodies, so the body edges are offered alongside the wicks. Beyond the
 * threshold the tap is taken exactly as it is.
 */
export function magnet(
  price: number,
  bar: { open: number; high: number; low: number; close: number } | undefined,
  toY: (p: number) => number | null,
  thresholdPx = 10,
): number {
  if (!bar) return price;
  const y = toY(price);
  if (y === null) return price;
  let best = price, bestD = thresholdPx;
  for (const p of [bar.open, bar.high, bar.low, bar.close]) {
    const py = toY(p);
    if (py === null) continue;
    const d = Math.abs(py - y);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}
