import { describe, expect, it } from "vitest";
import {
  ExnessTickParser, TickDayAccumulator, makeTimestampParser, priceToInt, storageDecimals, type TickDay,
} from "@/lib/core/market/exness-ticks";

// The first lines of a real Exness gold tick download (public market data).
const SAMPLE = [
  "Exness\tSymbol\tTimestamp\tBid\tAsk",
  "exness\tXAUUSDm\t2025-01-01 23:05:07.737Z\t2625.179\t2625.339",
  "exness\tXAUUSDm\t2025-01-01 23:05:09.152Z\t2625.114\t2625.274",
  "exness\tXAUUSDm\t2025-01-01 23:05:09.164Z\t2625.153\t2625.313",
  "exness\tXAUUSDm\t2025-01-01 23:05:12.849Z\t2625.21\t2625.37",
].join("\n");

function parseAll(text: string, chunk = text.length) {
  const ticks: [number, number, number][] = [];
  const p = new ExnessTickParser({ decimals: 3, onTick: (t, b, a) => ticks.push([t, b, a]) });
  for (let i = 0; i < text.length; i += chunk) p.push(text.slice(i, i + chunk));
  p.end();
  return { ticks, p };
}

describe("priceToInt", () => {
  it("reads prices straight from the text at a fixed scale", () => {
    expect(priceToInt("2625.179", 3)).toBe(2625179);
    expect(priceToInt("2625.21", 3)).toBe(2625210);
    expect(priceToInt("2625", 3)).toBe(2625000);
    expect(priceToInt("0.5", 3)).toBe(500);
  });

  it("rounds digits beyond the scale half-up", () => {
    expect(priceToInt("1.23449", 3)).toBe(1234);
    expect(priceToInt("1.2345", 3)).toBe(1235);
  });

  it("refuses anything that is not a plain number", () => {
    for (const bad of ["", ".", "-1.2", "1,2", "abc", "1.2.3", "1e5"]) expect(priceToInt(bad, 3)).toBeNaN();
  });
});

describe("timestamps", () => {
  const ts = makeTimestampParser();

  it("reads Exness's UTC timestamps to the millisecond", () => {
    expect(ts("2025-01-01 23:05:07.737Z")).toBe(Date.UTC(2025, 0, 1, 23, 5, 7, 737));
  });

  it("accepts the other common spellings", () => {
    const want = Date.UTC(2024, 2, 9, 4, 0, 1, 500);
    expect(ts("2024-03-09T04:00:01.5Z")).toBe(want);
    expect(ts("2024.03.09 04:00:01.500")).toBe(want);
    expect(ts("2024-03-09 04:00:01.500123")).toBe(want);
    expect(ts("2024-03-09 04:00:01")).toBe(want - 500);
  });

  it("stays right across a date change", () => {
    expect(ts("2025-01-01 23:59:59.999Z")).toBe(Date.UTC(2025, 0, 1, 23, 59, 59, 999));
    expect(ts("2025-01-02 00:00:00.000Z")).toBe(Date.UTC(2025, 0, 2));
  });

  it("refuses malformed times", () => {
    for (const bad of ["2025-13-01 00:00:00", "2025-01-01 25:00:00", "2025-01-01", "yesterday at noon!!"]) {
      expect(ts(bad)).toBeNaN();
    }
  });
});

describe("ExnessTickParser", () => {
  it("parses the sample, header and all", () => {
    const { ticks, p } = parseAll(SAMPLE);
    expect(ticks).toEqual([
      [Date.UTC(2025, 0, 1, 23, 5, 7, 737), 2625179, 2625339],
      [Date.UTC(2025, 0, 1, 23, 5, 9, 152), 2625114, 2625274],
      [Date.UTC(2025, 0, 1, 23, 5, 9, 164), 2625153, 2625313],
      [Date.UTC(2025, 0, 1, 23, 5, 12, 849), 2625210, 2625370],
    ]);
    expect(p.sourceSymbol).toBe("XAUUSDm");
    expect(p.symbol).toBe("XAUUSD");
    expect(p.stats).toMatchObject({ lines: 5, ticks: 4, malformed: 0, badPrice: 0 });
  });

  it("gives the same ticks however the text is cut into chunks", () => {
    const whole = parseAll(SAMPLE).ticks;
    for (const size of [1, 7, 33, 64]) expect(parseAll(SAMPLE, size).ticks).toEqual(whole);
  });

  it("handles commas, quotes and Windows line endings", () => {
    const csv = SAMPLE.replace(/\t/g, ",").split("\n")
      .map((l) => l.split(",").map((f) => `"${f}"`).join(",")).join("\r\n");
    expect(parseAll(csv).ticks).toEqual(parseAll(SAMPLE).ticks);
  });

  it("follows the header when the columns are in another order", () => {
    const moved = "Bid,Ask,Timestamp\n2625.179,2625.339,2025-01-01 23:05:07.737Z";
    expect(parseAll(moved).ticks).toEqual([[Date.UTC(2025, 0, 1, 23, 5, 7, 737), 2625179, 2625339]]);
  });

  it("skips and counts bad lines rather than stopping", () => {
    const text = [
      SAMPLE.split("\n")[0],
      "exness\tXAUUSDm\tnot a time\t1\t2",
      "exness\tXAUUSDm\t2025-01-01 23:05:07.737Z\t2625.4\t2625.3", // ask below bid
      "exness\tXAUUSDm\t2025-01-01 23:05:07.737Z\t0\t0.1",
      "exness\tEURUSDm\t2025-01-01 23:05:07.737Z\t1.03\t1.04",
      "short line",
      "exness\tXAUUSDm\t2025-01-01 23:05:08.000Z\t2625.1\t2625.2",
    ].join("\n");
    const { ticks, p } = parseAll(text);
    expect(ticks).toHaveLength(1);
    expect(p.stats).toMatchObject({ malformed: 2, badPrice: 2, otherSymbol: 1, ticks: 1 });
  });

  it("knows how finely each symbol is stored", () => {
    expect(storageDecimals("XAUUSDm")).toBe(3);
    expect(storageDecimals("EURUSD")).toBe(5);
    expect(storageDecimals("USDJPY")).toBe(3);
  });
});

describe("TickDayAccumulator", () => {
  const collect = () => {
    const days: TickDay[] = [];
    const acc = new TickDayAccumulator({ symbol: "XAUUSD", decimals: 3, onDay: (d) => days.push(d) });
    return { days, acc };
  };
  const D1 = Date.UTC(2025, 0, 1), D2 = Date.UTC(2025, 0, 2);

  it("splits ticks into UTC days and hands each on when the next begins", () => {
    const { days, acc } = collect();
    acc.add(D1 + 1000, 10, 12);
    acc.add(D1 + 2000, 11, 13);
    expect(days).toHaveLength(0);
    acc.add(D2 + 5, 12, 14);
    expect(days).toHaveLength(1);
    acc.finish();
    expect(days.map((d) => [d.day, d.count])).toEqual([["2025-01-01", 2], ["2025-01-02", 1]]);
    expect(Array.from(days[0].ms)).toEqual([1000, 2000]);
    expect(days[0].dayStart).toBe(D1 / 1000);
  });

  it("puts out-of-order ticks back in place, keeping ties in file order", () => {
    const { days, acc } = collect();
    acc.add(D1 + 3000, 3, 4);
    acc.add(D1 + 1000, 1, 2);
    acc.add(D1 + 1000, 5, 6);
    acc.finish();
    expect(Array.from(days[0].ms)).toEqual([1000, 1000, 3000]);
    expect(Array.from(days[0].bid)).toEqual([1, 5, 3]);
    expect(days[0].reordered).toBe(1);
  });

  it("counts ticks for a day already handed on instead of misplacing them", () => {
    const { days, acc } = collect();
    acc.add(D2 + 1, 1, 2);
    acc.add(D1 + 1, 1, 2);
    acc.finish();
    expect(days).toHaveLength(1);
    expect(acc.late).toBe(1);
  });

  it("grows past its starting size", () => {
    const { days, acc } = collect();
    for (let i = 0; i < 70_000; i++) acc.add(D1 + i, 100 + (i % 7), 110 + (i % 7));
    acc.finish();
    expect(days[0].count).toBe(70_000);
    expect(days[0].ms[69_999]).toBe(69_999);
  });
});
