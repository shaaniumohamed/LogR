/**
 * Candle CSV parser.
 *
 * Deliberately format-agnostic rather than tied to one provider. The free
 * sources for XAUUSD minute data each emit a different shape — HistData writes
 * `YYYYMMDD HHMMSS;O;H;L;C;V` with no header, Dukascopy writes an ISO datetime
 * with one, others use epoch seconds — and a parser that only accepts one of
 * them fails the moment a source changes its mind or goes away.
 *
 * So: sniff the delimiter, sniff the header, find the columns by name where
 * there is a header and by position where there is not.
 */

export interface Candle {
  /** Epoch SECONDS, UTC. Seconds rather than milliseconds because that is what
   *  the chart library takes and what Postgres stores in four bytes. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandleParseResult {
  candles: Candle[];
  skipped: number;
  /** How the columns were identified, so the import screen can show its working. */
  format: string;
  from: Date | null;
  to: Date | null;
}

export interface ParseCandleOptions {
  /**
   * IANA zone the file's timestamps are written in, e.g. "America/New_York".
   *
   * Preferred over a fixed offset because the sources that need shifting are
   * exactly the ones that observe daylight saving. HistData publishes XAUUSD in
   * US Eastern, so a single month's file can contain both EST and EDT
   * timestamps; a fixed −5h shift puts half of March an hour out, which lands
   * every fill in the wrong candle for that half.
   */
  sourceZone?: string;
  /** Fixed shift in minutes east of UTC, for a source with no DST. Ignored when sourceZone is set. */
  offsetMinutes?: number;
}

const NUM = (v: string) => {
  const n = Number(String(v ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/* ------------------------------------------------------- zone arithmetic */

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function fmtFor(zone: string) {
  let f = FMT_CACHE.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    FMT_CACHE.set(zone, f);
  }
  return f;
}

/** Minutes east of UTC that `zone` was observing at the given instant. */
function zoneOffsetAt(utcMs: number, zone: string): number {
  const p = Object.fromEntries(
    fmtFor(zone).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * A wall-clock reading in `zone` → the UTC instant it names.
 *
 * Two passes, because the offset we need is the one in force at the ANSWER, not
 * at the question: read the offset at a first guess, correct, then read it again
 * at the corrected instant. That second read is what gets the hour either side
 * of a daylight-saving change right.
 */
function wallToUtc(wallAsUtcMs: number, zone: string): number {
  const first = zoneOffsetAt(wallAsUtcMs, zone);
  const second = zoneOffsetAt(wallAsUtcMs - first * 60000, zone);
  return wallAsUtcMs - second * 60000;
}

/* ------------------------------------------------------------- parsing */

type Stamp = { wallMs: number; absolute: boolean };

/** Reads a timestamp without deciding what zone it is in — that is the caller's job. */
function parseStamp(raw: string): Stamp | null {
  const s = String(raw ?? "").trim().replace(/^"|"$/g, "");
  if (!s) return null;

  // HistData and friends: 20260918 143000, 20260918T143000, 20260918 1430
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})(\d{2})?$/);
  if (compact) {
    const [, y, mo, d, h, mi, sec] = compact;
    return { wallMs: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0)), absolute: false };
  }

  // Epoch is by definition already UTC, so no zone can apply to it.
  if (/^\d{10}$/.test(s)) return { wallMs: Number(s) * 1000, absolute: true };
  if (/^\d{13}$/.test(s)) return { wallMs: Number(s), absolute: true };

  // ISO-ish: 2026-09-18 14:30:00, 2026-09-18T14:30:00Z, 2026-09-18T14:30:00+08:00
  const iso = s.includes("T") || s.includes(" ") ? s.replace(" ", "T") : `${s}T00:00:00`;
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return { wallMs: d.getTime(), absolute: hasZone };
}

const splitLine = (line: string, delim: string) =>
  line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

export function parseCandleCsv(text: string, opts: ParseCandleOptions = {}): CandleParseResult {
  const { sourceZone, offsetMinutes = 0 } = opts;
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("That file is empty.");

  // Whichever delimiter appears most in the first line wins.
  const delim = [";", ",", "\t"]
    .map((d) => ({ d, n: lines[0].split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const head = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const looksLikeHeader = head.some((h) => /open|high|low|close|date|time/.test(h)) &&
    head.every((h) => Number.isNaN(Number(h)) || h === "");

  let cols = { t: 0, o: 1, h: 2, l: 3, c: 4 };
  let format = "no header — read as time, open, high, low, close";

  if (looksLikeHeader) {
    const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const t = find("datetime", "timestamp", "date", "time");
    const o = find("open"), hi = find("high"), lo = find("low"), c = find("close");
    if ([t, o, hi, lo, c].some((i) => i === -1)) {
      throw new Error(`Could not find open/high/low/close columns. Found: ${head.join(", ")}`);
    }
    cols = { t, o, h: hi, l: lo, c };
    format = "column names from the header row";
  }

  const candles: Candle[] = [];
  let skipped = 0;
  const seen = new Set<number>();

  for (let i = looksLikeHeader ? 1 : 0; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const stamp = parseStamp(cells[cols.t]);
    const open = NUM(cells[cols.o]), high = NUM(cells[cols.h]);
    const low = NUM(cells[cols.l]), close = NUM(cells[cols.c]);
    if (!stamp || [open, high, low, close].some(Number.isNaN) || high < low) { skipped++; continue; }

    const utcMs = stamp.absolute
      ? stamp.wallMs
      : sourceZone
        ? wallToUtc(stamp.wallMs, sourceZone)
        : stamp.wallMs - offsetMinutes * 60000;

    const time = Math.floor(utcMs / 1000);
    if (seen.has(time)) { skipped++; continue; }
    seen.add(time);
    candles.push({ time, open, high, low, close });
  }

  if (!candles.length) {
    throw new Error("No usable rows. Expecting a timestamp followed by open, high, low and close.");
  }
  candles.sort((a, b) => a.time - b.time);

  return {
    candles,
    skipped,
    format: sourceZone ? `${format}, times read as ${sourceZone}` : format,
    from: new Date(candles[0].time * 1000),
    to: new Date(candles[candles.length - 1].time * 1000),
  };
}

/**
 * Roll one-minute bars up to a coarser timeframe.
 *
 * Only M1 is ever stored. Rolling up is a few microseconds and lossless in the
 * direction that matters; storing M1, M5, M15 and H1 separately would quadruple
 * the row count to save an operation that costs nothing.
 */
export function aggregate(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles;
  const bucket = minutes * 60;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const t = Math.floor(c.time / bucket) * bucket;
    if (!cur || cur.time !== t) {
      if (cur) out.push(cur);
      cur = { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* --------------------------------------------------- proving the alignment */

export interface Fill {
  /** Epoch seconds, UTC. */
  time: number;
  price: number;
}

export interface AlignmentReport {
  /** Fills that fall inside the candle file's date range and could be checked. */
  checked: number;
  /** Of those, how many landed inside the high–low of their own candle. */
  inside: number;
  /** inside / checked, or null when nothing overlapped. */
  score: number | null;
  /** The shift, in minutes, that would score best. 0 means the file is already right. */
  bestShiftMinutes: number;
  bestScore: number | null;
  /**
   * True when no single shift works but two shifts an hour apart together cover
   * nearly everything — the signature of a file that spans a clock change.
   * The fix is to name the source zone, not to shift by a number.
   */
  dstLikely: boolean;
  /** What the two shifts together would score, when dstLikely. */
  combinedScore: number | null;
}

/**
 * Does this candle file actually line up with these fills?
 *
 * The single most likely way candle import goes wrong is a timezone: the file
 * loads, the chart draws, everything looks plausible, and every marker sits five
 * hours away from the bar it belongs to. Nothing on screen says so.
 *
 * But the data can answer it. A fill happened at a price the market was actually
 * trading, so it must fall inside the high–low of the minute it happened in. Run
 * that test across a few hundred fills and a correct file scores near 1 while a
 * misaligned one collapses — gold moves far enough in five hours that a stale
 * price is almost never inside the wrong bar. Sweeping candidate shifts then
 * recovers the right one without the trader having to know what a zone is.
 *
 * @param tolerance Points of slack. Left unset it calibrates itself to the
 *   instrument: one typical bar's range, never below 0.5. Slack is needed
 *   because a fill carries the spread and a price source is rarely the same
 *   aggregate as the broker's own feed, and how much of it is needed depends
 *   entirely on what is being traded — a fifth of a point is generous on gold
 *   and meaningless on an index. Being generous costs almost nothing here: a
 *   file that is hours out has its fills tens of points from the bar, not
 *   fractions of one.
 */
export function checkAlignment(
  candles: Candle[],
  fills: Fill[],
  { tolerance, maxShiftHours = 14, stepMinutes = 15 }: {
    tolerance?: number; maxShiftHours?: number; stepMinutes?: number;
  } = {},
): AlignmentReport {
  const empty: AlignmentReport = {
    checked: 0, inside: 0, score: null, bestShiftMinutes: 0, bestScore: null,
    dstLikely: false, combinedScore: null,
  };
  if (!candles.length || !fills.length) return empty;

  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(Math.floor(c.time / 60) * 60, c);

  // Median rather than mean: one spike would drag a mean wide enough to start
  // accepting bars the fill never belonged to.
  const ranges = candles.map((c) => c.high - c.low).sort((a, b) => a - b);
  const typicalRange = ranges[Math.floor(ranges.length / 2)] ?? 0;
  const slack = tolerance ?? Math.max(0.5, typicalRange);

  const window = maxShiftHours * 3600;
  const first = candles[0].time - window;
  const last = candles[candles.length - 1].time + window;
  // Only fills the file could plausibly cover; the rest say nothing either way.
  const relevant = fills.filter((f) => f.time >= first && f.time <= last);
  if (!relevant.length) return empty;

  /** Which fills land inside their own candle once the file is shifted by this much. */
  const matchesAt = (shiftMinutes: number) => {
    const hit = new Uint8Array(relevant.length);
    let n = 0;
    for (let i = 0; i < relevant.length; i++) {
      const f = relevant[i];
      const c = byTime.get(Math.floor((f.time - shiftMinutes * 60) / 60) * 60);
      if (c && f.price >= c.low - slack && f.price <= c.high + slack) { hit[i] = 1; n++; }
    }
    return { hit, n };
  };

  const atZero = matchesAt(0);
  let bestShift = 0, best = atZero;
  for (let m = -maxShiftHours * 60; m <= maxShiftHours * 60; m += stepMinutes) {
    if (m === 0) continue;
    const r = matchesAt(m);
    if (r.n > best.n) { best = r; bestShift = m; }
  }

  /*
   * A file written in a zone that observes daylight saving needs one shift for
   * part of the year and a shift an hour away for the rest, so no single number
   * fixes it and the naive verdict would be "these candles are not this market"
   * — wrong, and the opposite of the action that helps. Testing the hour either
   * side of the best shift separates "wrong instrument" from "right instrument,
   * summer time".
   */
  let combined: number | null = null;
  for (const other of [bestShift + 60, bestShift - 60]) {
    const r = matchesAt(other);
    let union = 0;
    for (let i = 0; i < relevant.length; i++) if (best.hit[i] || r.hit[i]) union++;
    const s = union / relevant.length;
    if (combined === null || s > combined) combined = s;
  }
  const bestScore = best.n / relevant.length;
  const dstLikely = bestScore < 0.9 && combined !== null && combined >= 0.9;

  return {
    checked: relevant.length,
    inside: atZero.n,
    score: atZero.n / relevant.length,
    bestShiftMinutes: bestShift,
    bestScore,
    dstLikely,
    combinedScore: combined,
  };
}
