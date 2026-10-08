import { normalizeSymbol } from "../symbols";

/**
 * Reading an Exness tick history file, a line at a time.
 *
 * The files are large — about 2 GB of text for a year of gold — so nothing
 * here ever holds a whole file. Text arrives in chunks of any size, possibly
 * cut mid-line, and each complete line becomes one tick handed straight on.
 *
 * The format, from the trader's own download:
 *
 *   Exness	Symbol	Timestamp	Bid	Ask
 *   exness	XAUUSDm	2025-01-01 23:05:07.737Z	2625.179	2625.339
 *
 * Tab-separated in that sample; commas are accepted too, and quoted fields,
 * because the same history re-saved by a spreadsheet comes back that way.
 *
 * Prices become integers at a fixed number of decimals, parsed from the text
 * itself. Going through a float first would turn 2625.179 into
 * 2625.1789999999… on some values, and a stop at a round number would then
 * trigger or not depending on rounding — which is the kind of error a
 * backtester must not have.
 */

/** Decimals a symbol's prices are STORED at — finer than they are displayed. */
export function storageDecimals(symbol: string): number {
  const s = normalizeSymbol(symbol);
  if (s.startsWith("XAU")) return 3;
  if (s.startsWith("XAG")) return 4;
  if (/^[A-Z]{6}$/.test(s)) return s.includes("JPY") ? 3 : 5;
  return 3;
}

/**
 * "2625.179" at 3 decimals → 2625179. "2625.21" → 2625210. More digits than
 * the scale are rounded half-up. NaN for anything that is not a plain
 * non-negative decimal number.
 */
export function priceToInt(s: string, decimals: number, from = 0, to = s.length): number {
  let i = from;
  const n = to;
  let whole = 0;
  let digits = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 46 /* . */) break;
    if (c < 48 || c > 57) return NaN;
    whole = whole * 10 + (c - 48);
    digits++;
  }
  let frac = 0;
  let fracDigits = 0;
  let roundUp = false;
  if (i < n) {
    for (i++; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c < 48 || c > 57) return NaN;
      if (fracDigits < decimals) { frac = frac * 10 + (c - 48); fracDigits++; }
      else if (fracDigits === decimals) { roundUp = c >= 53; fracDigits++; }
      digits++;
    }
  }
  if (digits === 0) return NaN;
  const used = Math.min(fracDigits, decimals);
  let v = whole * 10 ** decimals + frac * 10 ** (decimals - used);
  if (roundUp) v += 1;
  return v;
}

const DAY_MS = 86_400_000;

/**
 * A timestamp parser that remembers the last date it saw.
 *
 * Consecutive ticks almost always share a date, so the expensive part — turning
 * a calendar date into epoch time — runs once a day instead of 140,000 times.
 * Accepts `YYYY-MM-DD HH:MM:SS[.fff…][Z]`, with `-`, `.` or `/` in the date and
 * a space or `T` before the time. Times are taken as UTC, which is what Exness
 * writes (the trailing Z).
 */
export function makeTimestampParser(): (s: string, from?: number, to?: number) => number {
  let lastDate = "";
  let lastDayMs = NaN;
  const num = (s: string, a: number, b: number) => {
    let v = 0;
    for (let i = a; i < b; i++) {
      const c = s.charCodeAt(i) - 48;
      if (c < 0 || c > 9) return NaN;
      v = v * 10 + c;
    }
    return v;
  };
  return (s: string, o = 0, to = s.length) => {
    if (to - o < 19) return NaN;
    // Same date as the last tick: skip the calendar arithmetic entirely.
    if (!(lastDate.length === 10 && s.startsWith(lastDate, o))) {
      const y = num(s, o, o + 4), m = num(s, o + 5, o + 7), d = num(s, o + 8, o + 10);
      if (!(y >= 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return NaN;
      lastDayMs = Date.UTC(y, m - 1, d);
      lastDate = s.slice(o, o + 10);
    }
    const sep = s.charCodeAt(o + 10);
    if (sep !== 32 && sep !== 84 /* T */) return NaN;
    const hh = num(s, o + 11, o + 13), mm = num(s, o + 14, o + 16), ss = num(s, o + 17, o + 19);
    if (!(hh <= 23 && mm <= 59 && ss <= 60)) return NaN;
    let ms = 0;
    if (to - o > 20 && s.charCodeAt(o + 19) === 46) {
      // Up to three fraction digits are milliseconds; any further are dropped.
      let scale = 100;
      for (let k = o + 20; k < to; k++) {
        const c = s.charCodeAt(k) - 48;
        if (c < 0 || c > 9) break;
        if (scale >= 1) { ms += c * scale; scale /= 10; }
      }
    }
    return lastDayMs + ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
  };
}

export interface TickParseStats {
  lines: number;
  ticks: number;
  /** Lines that were not ticks at all: blank, malformed, unparseable numbers. */
  malformed: number;
  /** Ask below bid, or a price of zero. Real feeds occasionally emit both. */
  badPrice: number;
  /** Lines for a different symbol than the first one seen. */
  otherSymbol: number;
}

export type TickSink = (timeMs: number, bid: number, ask: number) => void;

/**
 * Turns chunks of text into ticks.
 *
 * Feed it with `push(text)` as the file streams in and call `end()` once; every
 * valid tick is passed to `onTick` in file order, as epoch milliseconds and
 * integer prices.
 */
export class ExnessTickParser {
  readonly stats: TickParseStats = { lines: 0, ticks: 0, malformed: 0, badPrice: 0, otherSymbol: 0 };
  /** The source symbol as written in the file, e.g. "XAUUSDm". */
  sourceSymbol: string | null = null;

  private rest = "";
  private delim: string | null = null;
  private col = { symbol: 1, time: 2, bid: 3, ask: 4 };
  private sawHeader = false;
  private readonly ts = makeTimestampParser();

  constructor(private readonly opts: { decimals: number; onTick: TickSink }) {}

  /** The normalised symbol (XAUUSDm → XAUUSD), once a tick has been read. */
  get symbol(): string | null {
    return this.sourceSymbol ? normalizeSymbol(this.sourceSymbol) : null;
  }

  push(chunk: string): void {
    const text = this.rest + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf("\n", start);
      if (nl < 0) break;
      this.line(text, start, nl);
      start = nl + 1;
    }
    this.rest = text.slice(start);
  }

  end(): void {
    if (this.rest) this.line(this.rest, 0, this.rest.length);
    this.rest = "";
  }

  // Field boundaries for the line being read, reused so the hot path allocates
  // nothing: a year of gold is tens of millions of lines.
  private fs = new Int32Array(16);
  private fe = new Int32Array(16);

  private line(text: string, a: number, b: number): void {
    if (b > a && text.charCodeAt(b - 1) === 13) b--; // CRLF
    if (b <= a) return;
    this.stats.lines++;

    if (this.delim === null) {
      const raw = text.slice(a, b);
      this.delim = raw.includes("\t") ? "\t" : raw.includes(";") && !raw.includes(",") ? ";" : ",";
    }

    // Split in place: record where each field starts and ends, trimming
    // surrounding spaces and quotes, without making a string per field.
    const fs = this.fs, fe = this.fe;
    let nf = 0;
    let pos = a;
    while (nf < 16) {
      let e = text.indexOf(this.delim, pos);
      if (e < 0 || e > b) e = b;
      let s0 = pos, e0 = e;
      while (s0 < e0 && text.charCodeAt(s0) === 32) s0++;
      while (e0 > s0 && text.charCodeAt(e0 - 1) === 32) e0--;
      if (e0 - s0 >= 2 && text.charCodeAt(s0) === 34 && text.charCodeAt(e0 - 1) === 34) { s0++; e0--; }
      fs[nf] = s0; fe[nf] = e0; nf++;
      if (e === b) break;
      pos = e + 1;
    }

    // The header names the columns. Read it rather than assume the order, so
    // a file re-saved with columns moved around still imports correctly.
    if (!this.sawHeader && this.stats.ticks === 0) {
      const raw = text.slice(a, b);
      if (/timestamp|time/i.test(raw) && /bid/i.test(raw)) {
        this.sawHeader = true;
        const lower = Array.from({ length: nf }, (_, i) => text.slice(fs[i], fe[i]).toLowerCase());
        const find = (re: RegExp) => lower.findIndex((x) => re.test(x));
        const time = find(/^(timestamp|time|date ?time)$/);
        const bid = find(/^bid$/);
        const ask = find(/^ask$/);
        const symbol = find(/^symbol$/);
        if (time >= 0 && bid >= 0 && ask >= 0) this.col = { symbol, time, bid, ask };
        return;
      }
      // No header: three columns are time/bid/ask, five follow Exness's order.
      if (nf === 3) this.col = { symbol: -1, time: 0, bid: 1, ask: 2 };
    }

    const { symbol, time, bid, ask } = this.col;
    if (nf <= Math.max(time, bid, ask, symbol)) { this.stats.malformed++; return; }

    if (symbol >= 0) {
      const ss = fs[symbol], se = fe[symbol];
      const known = this.sourceSymbol;
      if (known === null) this.sourceSymbol = text.slice(ss, se);
      else if (se - ss !== known.length || !text.startsWith(known, ss)) { this.stats.otherSymbol++; return; }
    }

    const t = this.ts(text, fs[time], fe[time]);
    const b2 = priceToInt(text, this.opts.decimals, fs[bid], fe[bid]);
    const a2 = priceToInt(text, this.opts.decimals, fs[ask], fe[ask]);
    if (!Number.isFinite(t) || Number.isNaN(b2) || Number.isNaN(a2)) { this.stats.malformed++; return; }
    if (b2 <= 0 || a2 <= 0 || a2 < b2) { this.stats.badPrice++; return; }

    this.stats.ticks++;
    this.opts.onTick(t, b2, a2);
  }
}

/* ------------------------------------------------------------ one UTC day */

export interface TickDay {
  symbol: string;
  /** "YYYY-MM-DD", UTC. */
  day: string;
  /** UTC midnight, epoch seconds. */
  dayStart: number;
  decimals: number;
  count: number;
  /** Milliseconds since dayStart, ascending. */
  ms: Int32Array;
  bid: Int32Array;
  ask: Int32Array;
  /** Ticks that arrived out of order within the day and were put back in place. */
  reordered: number;
}

export const dayKey = (dayStartSec: number) => new Date(dayStartSec * 1000).toISOString().slice(0, 10);

/**
 * Collects ticks into UTC days and hands each day on as soon as it is complete.
 *
 * A year of ticks never sits in memory, only the day being built. Ticks for a
 * day that has already been handed on cannot be added to it any more; they are
 * counted as `late` rather than silently placed in the wrong day. Exness files
 * are in time order, so in practice that count is zero — and if it is not, the
 * import says so.
 */
export class TickDayAccumulator {
  late = 0;
  days = 0;

  private day = -1;
  private n = 0;
  private ms = new Int32Array(1 << 16);
  private bid = new Int32Array(1 << 16);
  private ask = new Int32Array(1 << 16);
  private unsorted = 0;
  private lastMs = -1;

  constructor(private readonly opts: { symbol: string; decimals: number; onDay: (d: TickDay) => void }) {}

  add(timeMs: number, bid: number, ask: number): void {
    const d = Math.floor(timeMs / DAY_MS);
    if (d !== this.day) {
      if (d < this.day) { this.late++; return; }
      this.flush();
      this.day = d;
    }
    if (this.n === this.ms.length) this.grow();
    const m = timeMs - d * DAY_MS;
    if (m < this.lastMs) this.unsorted++;
    this.lastMs = m;
    this.ms[this.n] = m;
    this.bid[this.n] = bid;
    this.ask[this.n] = ask;
    this.n++;
  }

  /** Hand on the day in progress. Call once at the end of the input. */
  finish(): void {
    this.flush();
  }

  private grow(): void {
    const next = (a: Int32Array) => { const b = new Int32Array(a.length * 2); b.set(a); return b; };
    this.ms = next(this.ms);
    this.bid = next(this.bid);
    this.ask = next(this.ask);
  }

  private flush(): void {
    if (this.day < 0 || this.n === 0) { this.reset(); return; }
    let ms = this.ms.slice(0, this.n), bid = this.bid.slice(0, this.n), ask = this.ask.slice(0, this.n);
    if (this.unsorted) {
      // Stable: ticks sharing a millisecond keep their file order.
      const idx = Array.from({ length: this.n }, (_, i) => i).sort((a, b) => ms[a] - ms[b] || a - b);
      const take = (src: Int32Array) => Int32Array.from(idx, (i) => src[i]);
      ms = take(ms); bid = take(bid); ask = take(ask);
    }
    const dayStart = this.day * 86_400;
    this.days++;
    this.opts.onDay({
      symbol: this.opts.symbol, day: dayKey(dayStart), dayStart, decimals: this.opts.decimals,
      count: this.n, ms, bid, ask, reordered: this.unsorted,
    });
    this.reset();
  }

  private reset(): void {
    this.n = 0;
    this.unsorted = 0;
    this.lastMs = -1;
  }
}
