import { ByteReader, ByteWriter, MarketFormatError } from "./bytes";

/**
 * The two file types the market data store holds. Specified in
 * docs/30-backtesting.md ("File formats"); keep the two in step.
 *
 * Both are columnar — every time, then every price — because neighbouring
 * values of the same kind are close to each other and gzip, applied to the
 * whole file afterwards, compresses runs of similar bytes far better than
 * interleaved records. Both carry a magic word and a version, so a file from a
 * future format is refused loudly instead of being misread as prices.
 */

export const TICK_MAGIC = "LGRT";
export const BAR_MAGIC = "LGRB";
export const FORMAT_VERSION = 1;

/** One UTC day of ticks. Prices are integers at `decimals`. */
export interface TickSeries {
  /** UTC midnight, epoch seconds. */
  dayStart: number;
  decimals: number;
  count: number;
  /** Milliseconds since dayStart, ascending. */
  ms: Int32Array;
  bid: Int32Array;
  ask: Int32Array;
}

/** Bars of one resolution. Bid prices, like MT5's charts. */
export interface BarSeries {
  /** Seconds per bar. */
  resolution: number;
  decimals: number;
  count: number;
  /** Open time, epoch seconds, ascending and aligned to `resolution`. */
  time: Uint32Array;
  open: Int32Array;
  high: Int32Array;
  low: Int32Array;
  close: Int32Array;
  /** Ticks in the bar. CFDs have no exchange volume; tick count is what MT5 shows. */
  volume: Uint32Array;
  /** Mean and widest ask − bid during the bar, in price units. */
  spreadAvg: Int32Array;
  spreadMax: Int32Array;
}

export function encodeTicks(t: TickSeries): Uint8Array {
  const w = new ByteWriter(64 + t.count * 4);
  w.ascii(TICK_MAGIC);
  w.u8(FORMAT_VERSION);
  w.u8(t.decimals);
  w.u16(0);
  w.u32(t.dayStart);
  w.u32(t.count);

  const times = new ByteWriter(t.count * 2), bids = new ByteWriter(t.count * 2), spreads = new ByteWriter(t.count);
  let prevMs = 0, prevBid = 0, prevSpread = 0;
  for (let i = 0; i < t.count; i++) {
    const ms = t.ms[i];
    if (ms < prevMs) throw new MarketFormatError("Ticks must be in time order.");
    const spread = t.ask[i] - t.bid[i];
    if (spread < 0) throw new MarketFormatError("Ask below bid.");
    times.varint(ms - prevMs);
    bids.svarint(t.bid[i] - prevBid);
    spreads.svarint(spread - prevSpread);
    prevMs = ms; prevBid = t.bid[i]; prevSpread = spread;
  }
  w.section(times);
  w.section(bids);
  w.section(spreads);
  return w.finish();
}

function header(r: ByteReader, magic: string) {
  const m = r.ascii(4);
  if (m !== magic) throw new MarketFormatError(`Not a ${magic} file.`);
  const version = r.u8();
  if (version !== FORMAT_VERSION) throw new MarketFormatError(`Unsupported ${magic} version ${version}.`);
  const decimals = r.u8();
  r.u16();
  return decimals;
}

export function decodeTicks(bytes: Uint8Array): TickSeries {
  const r = new ByteReader(bytes);
  const decimals = header(r, TICK_MAGIC);
  const dayStart = r.u32();
  const count = r.u32();
  const times = r.section(), bids = r.section(), spreads = r.section();
  const ms = new Int32Array(count), bid = new Int32Array(count), ask = new Int32Array(count);
  let m = 0, b = 0, s = 0;
  for (let i = 0; i < count; i++) {
    m += times.varint();
    b += bids.svarint();
    s += spreads.svarint();
    ms[i] = m; bid[i] = b; ask[i] = b + s;
  }
  return { dayStart, decimals, count, ms, bid, ask };
}

export function encodeBars(s: BarSeries): Uint8Array {
  const w = new ByteWriter(64 + s.count * 8);
  w.ascii(BAR_MAGIC);
  w.u8(FORMAT_VERSION);
  w.u8(s.decimals);
  w.u16(0);
  w.u32(s.resolution);
  w.u32(s.count ? s.time[0] : 0);
  w.u32(s.count);

  const cols = Array.from({ length: 8 }, () => new ByteWriter(s.count * 2));
  const [gaps, opens, highs, lows, closes, vols, avgs, maxs] = cols;
  let prevTime = s.count ? s.time[0] - s.resolution : 0, prevClose = 0;
  for (let i = 0; i < s.count; i++) {
    const t = s.time[i];
    if (t % s.resolution !== 0) throw new MarketFormatError("Bar time not aligned to its resolution.");
    const step = (t - prevTime) / s.resolution;
    if (step < 1) throw new MarketFormatError("Bars must be in time order, one per period.");
    const o = s.open[i], h = s.high[i], l = s.low[i], c = s.close[i];
    if (h < Math.max(o, c) || l > Math.min(o, c)) throw new MarketFormatError("Bar high/low do not contain open/close.");
    gaps.varint(step - 1);
    opens.svarint(o - prevClose);
    highs.varint(h - Math.max(o, c));
    lows.varint(Math.min(o, c) - l);
    closes.svarint(c - o);
    vols.varint(s.volume[i]);
    avgs.varint(s.spreadAvg[i]);
    maxs.varint(s.spreadMax[i]);
    prevTime = t; prevClose = c;
  }
  for (const c of cols) w.section(c);
  return w.finish();
}

export function decodeBars(bytes: Uint8Array): BarSeries {
  const r = new ByteReader(bytes);
  const decimals = header(r, BAR_MAGIC);
  const resolution = r.u32();
  const start = r.u32();
  const count = r.u32();
  const [gaps, opens, highs, lows, closes, vols, avgs, maxs] = Array.from({ length: 8 }, () => r.section());
  const s = emptyBars(resolution, decimals, count);
  let t = start - resolution, prevClose = 0;
  for (let i = 0; i < count; i++) {
    t += (gaps.varint() + 1) * resolution;
    const o = prevClose + opens.svarint();
    const hi = highs.varint(), lo = lows.varint();
    const c = o + closes.svarint();
    s.time[i] = t;
    s.open[i] = o;
    s.close[i] = c;
    s.high[i] = Math.max(o, c) + hi;
    s.low[i] = Math.min(o, c) - lo;
    s.volume[i] = vols.varint();
    s.spreadAvg[i] = avgs.varint();
    s.spreadMax[i] = maxs.varint();
    prevClose = c;
  }
  return s;
}

export function emptyBars(resolution: number, decimals: number, count: number): BarSeries {
  return {
    resolution, decimals, count,
    time: new Uint32Array(count),
    open: new Int32Array(count), high: new Int32Array(count),
    low: new Int32Array(count), close: new Int32Array(count),
    volume: new Uint32Array(count),
    spreadAvg: new Int32Array(count), spreadMax: new Int32Array(count),
  };
}
