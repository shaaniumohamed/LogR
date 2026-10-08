import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, MarketFormatError, gunzip, gzip, unzigzag, zigzag } from "@/lib/core/market/bytes";
import { decodeBars, decodeTicks, emptyBars, encodeBars, encodeTicks, type TickSeries } from "@/lib/core/market/format";
import { concatBars, dayBucket, forTimeframe, rollup, ticksToM1, timeframes, toCandles, weekBucket } from "@/lib/core/market/bars";
import { aggregate } from "@/lib/core/parse-candles";

const DAY0 = Date.UTC(2025, 0, 6) / 1000; // a Monday

/** A deterministic random-walk day of gold ticks, roughly the density of the real thing. */
function syntheticDay(count = 20_000, seed = 7): TickSeries {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ms = new Int32Array(count), bid = new Int32Array(count), ask = new Int32Array(count);
  let t = 60_000, p = 2_625_179;
  for (let i = 0; i < count; i++) {
    t += Math.floor(rnd() * 900);
    p += Math.round((rnd() - 0.5) * 60);
    ms[i] = t; bid[i] = p; ask[i] = p + 160 + (rnd() < 0.05 ? Math.round(rnd() * 80) : 0);
  }
  return { dayStart: DAY0, decimals: 3, count, ms, bid, ask };
}

describe("bytes", () => {
  it("folds signs and round-trips integers of every size", () => {
    for (const n of [0, 1, -1, 63, -64, 64, 1000, -1000, 2 ** 31, -(2 ** 31), 2 ** 50]) {
      expect(unzigzag(zigzag(n))).toBe(n);
      const w = new ByteWriter(1);
      w.svarint(n);
      w.varint(Math.abs(n));
      const r = new ByteReader(w.finish());
      expect(r.svarint()).toBe(n);
      expect(r.varint()).toBe(Math.abs(n));
      expect(r.done).toBe(true);
    }
  });

  it("keeps small numbers small", () => {
    const w = new ByteWriter();
    w.varint(127);
    expect(w.length).toBe(1);
    w.varint(128);
    expect(w.length).toBe(3);
  });

  it("refuses to read past the end", () => {
    const w = new ByteWriter();
    w.u32(5);
    expect(() => new ByteReader(w.finish().slice(0, 3)).u32()).toThrow(MarketFormatError);
  });

  it("gzips and back", async () => {
    const data = new Uint8Array(10_000).map((_, i) => i % 7);
    const z = await gzip(data);
    expect(z.length).toBeLessThan(data.length / 10);
    expect(await gunzip(z)).toEqual(data);
  });
});

describe("tick files", () => {
  it("round-trip exactly", () => {
    const day = syntheticDay();
    const back = decodeTicks(encodeTicks(day));
    expect(back.dayStart).toBe(day.dayStart);
    expect(back.decimals).toBe(3);
    expect(back.count).toBe(day.count);
    expect(back.ms).toEqual(day.ms);
    expect(back.bid).toEqual(day.bid);
    expect(back.ask).toEqual(day.ask);
  });

  it("compress to a few bytes per tick", async () => {
    const day = syntheticDay(50_000);
    const z = await gzip(encodeTicks(day));
    // Budget from docs/30-backtesting.md: ~3–4 bytes a tick for the year to fit comfortably.
    expect(z.length / day.count).toBeLessThan(4);
    expect(decodeTicks(await gunzip(z)).bid).toEqual(day.bid);
  });

  it("refuses ticks out of order or with ask below bid", () => {
    const bad = syntheticDay(10);
    bad.ms[5] = 0;
    expect(() => encodeTicks(bad)).toThrow(MarketFormatError);
    const crossed = syntheticDay(10);
    crossed.ask[3] = crossed.bid[3] - 1;
    expect(() => encodeTicks(crossed)).toThrow(MarketFormatError);
  });

  it("refuses a file that is not one, or is from a newer format", () => {
    const bytes = encodeTicks(syntheticDay(10));
    const notOurs = bytes.slice();
    notOurs[0] = 0x58;
    expect(() => decodeTicks(notOurs)).toThrow(/Not a LGRT/);
    const future = bytes.slice();
    future[4] = 99;
    expect(() => decodeTicks(future)).toThrow(/version 99/);
    expect(() => decodeTicks(bytes.slice(0, bytes.length - 5))).toThrow(MarketFormatError);
    expect(() => decodeBars(bytes)).toThrow(/Not a LGRB/);
  });
});

describe("ticks to M1", () => {
  it("builds bid candles with tick volume and spread", () => {
    const t: TickSeries = {
      dayStart: DAY0, decimals: 3, count: 5,
      ms: Int32Array.from([1_000, 20_000, 59_999, 61_000, 179_000]),
      bid: Int32Array.from([100, 105, 99, 101, 102]),
      ask: Int32Array.from([110, 125, 109, 111, 112]),
    };
    const m1 = ticksToM1(t);
    expect(m1.count).toBe(3);
    expect(Array.from(m1.time)).toEqual([DAY0, DAY0 + 60, DAY0 + 120]);
    expect([m1.open[0], m1.high[0], m1.low[0], m1.close[0]]).toEqual([100, 105, 99, 99]);
    expect(m1.volume[0]).toBe(3);
    expect(m1.spreadAvg[0]).toBe(Math.round((10 + 20 + 10) / 3));
    expect(m1.spreadMax[0]).toBe(20);
    expect([m1.open[2], m1.close[2], m1.volume[2]]).toEqual([102, 102, 1]);
  });

  it("round-trips through the bar file format, gaps included", () => {
    const day = syntheticDay(30_000);
    // Knock out a stretch of minutes so the file has to record a gap.
    const keep = Array.from({ length: day.count }, (_, i) => i).filter((i) => day.ms[i] < 3_000_000 || day.ms[i] > 4_000_000);
    const gappy: TickSeries = {
      ...day, count: keep.length,
      ms: Int32Array.from(keep, (i) => day.ms[i]), bid: Int32Array.from(keep, (i) => day.bid[i]), ask: Int32Array.from(keep, (i) => day.ask[i]),
    };
    const m1 = ticksToM1(gappy);
    expect(m1.count).toBeGreaterThan(150);
    expect(Array.from(m1.time).some((t, i) => i > 0 && t - m1.time[i - 1] > 60)).toBe(true);
    const back = decodeBars(encodeBars(m1));
    for (const k of ["time", "open", "high", "low", "close", "volume", "spreadAvg", "spreadMax"] as const) {
      expect(back[k]).toEqual(m1[k]);
    }
  });

  it("refuses bars that are misaligned or whose wicks do not contain the body", () => {
    const s = emptyBars(60, 3, 1);
    s.time[0] = DAY0 + 30;
    expect(() => encodeBars(s)).toThrow(/aligned/);
    s.time[0] = DAY0; s.open[0] = 10; s.close[0] = 12; s.high[0] = 11; s.low[0] = 9;
    expect(() => encodeBars(s)).toThrow(/high\/low/);
  });
});

describe("rolling up", () => {
  const m1 = ticksToM1(syntheticDay(40_000));

  it("agrees with the journal's existing aggregate()", () => {
    const candles = toCandles(m1).map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    for (const minutes of [3, 5, 15, 30]) {
      const mine = toCandles(rollup(m1, minutes * 60)).map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
      expect(mine).toEqual(aggregate(candles, minutes));
    }
  });

  it("gives the same hour whether built from M1 or from 15-minute candles", () => {
    const direct = rollup(m1, 3600);
    const viaM15 = rollup(rollup(m1, 900), 3600);
    for (const k of ["time", "open", "high", "low", "close", "volume", "spreadMax"] as const) {
      expect(viaM15[k]).toEqual(direct[k]);
    }
  });

  it("weights spread by tick count", () => {
    const s = emptyBars(60, 3, 2);
    s.time.set([DAY0, DAY0 + 60]);
    s.open.set([1, 1]); s.high.set([1, 1]); s.low.set([1, 1]); s.close.set([1, 1]);
    s.volume.set([1, 9]);
    s.spreadAvg.set([100, 0]);
    s.spreadMax.set([100, 5]);
    const h = rollup(s, 3600);
    expect(h.spreadAvg[0]).toBe(10);
    expect(h.spreadMax[0]).toBe(100);
  });

  it("joins months in order and refuses overlaps", () => {
    const a = rollup(m1, 300);
    const half = Math.floor(a.count / 2);
    const slice = (from: number, to: number) => {
      const s = emptyBars(a.resolution, a.decimals, to - from);
      for (const k of ["time", "open", "high", "low", "close", "volume", "spreadAvg", "spreadMax"] as const) {
        (s[k] as Int32Array).set((a[k] as Int32Array).subarray(from, to));
      }
      return s;
    };
    expect(concatBars([slice(0, half), slice(half, a.count)]).time).toEqual(a.time);
    expect(() => concatBars([slice(half, a.count), slice(0, half)])).toThrow(/order/);
  });
});

describe("days and weeks", () => {
  const sunday2300 = Date.UTC(2025, 0, 5, 23, 0) / 1000;
  const monday = Date.UTC(2025, 0, 6) / 1000;
  const wednesday = Date.UTC(2025, 0, 8, 13, 0) / 1000;

  it("folds Sunday's evening session into Monday's daily candle by default", () => {
    expect(dayBucket()(sunday2300)).toBe(monday);
    expect(dayBucket()(wednesday)).toBe(Date.UTC(2025, 0, 8) / 1000);
    expect(dayBucket(false)(sunday2300)).toBe(Date.UTC(2025, 0, 5) / 1000);
  });

  it("starts weeks on Monday, with Sunday evening in the week ahead", () => {
    expect(weekBucket(sunday2300)).toBe(monday);
    expect(weekBucket(wednesday)).toBe(monday);
    expect(weekBucket(Date.UTC(2025, 0, 12, 22) / 1000)).toBe(Date.UTC(2025, 0, 13) / 1000);
  });

  it("offers exactly the timeframes asked for", () => {
    expect(timeframes().map((t) => t.label)).toEqual(["1m", "3m", "5m", "10m", "15m", "30m", "1h", "4h", "1D", "1W"]);
  });

  it("builds 4h candles on the 00/04/08/12/16/20 UTC grid", () => {
    const h1 = rollup(m1Two(), 3600);
    const h4 = forTimeframe(h1, timeframes().find((t) => t.key === "4h")!);
    for (const t of h4.time) expect((t - monday) % 14_400).toBe(0);
  });
});

function m1Two() {
  const d = syntheticDay(60_000, 3);
  // Stretch the synthetic day across most of 24 hours.
  for (let i = 0; i < d.count; i++) d.ms[i] = Math.floor((i / d.count) * 86_000_000);
  return ticksToM1(d);
}
