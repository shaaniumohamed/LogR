import { describe, expect, it } from "vitest";
import { concatBars, forTimeframe, ticksToM1, timeframes } from "@/lib/core/market/bars";
import type { TickSeries } from "@/lib/core/market/format";
import { SESSIONS, barSpan, nextDayOpen, nextSessionOpen, sessionWindows, stepBar } from "@/lib/core/replay/clock";
import { closedBetween, foldBars, foldTicks, joinParts } from "@/lib/core/replay/forming";
import { ema, emaNext, sma, vwap } from "@/lib/core/indicators";

const tf = (key: string) => timeframes().find((t) => t.key === key)!;
const at = (iso: string) => Date.parse(iso) / 1000;

describe("where a candle starts and ends", () => {
  it("steps to the close of the candle now forming", () => {
    expect(stepBar(tf("5m"), at("2025-03-04T10:02:30Z"))).toBe(at("2025-03-04T10:05:00Z"));
    expect(stepBar(tf("5m"), at("2025-03-04T10:05:00Z"))).toBe(at("2025-03-04T10:10:00Z"));
    expect(stepBar(tf("4h"), at("2025-03-04T10:02:30Z"))).toBe(at("2025-03-04T12:00:00Z"));
  });

  it("folds Sunday evening into Monday's daily candle and into the week ahead", () => {
    const sun = at("2025-03-02T23:00:00Z");
    expect(barSpan(tf("1d"), sun)).toEqual({ key: at("2025-03-03T00:00:00Z"), start: at("2025-03-02T00:00:00Z"), end: at("2025-03-04T00:00:00Z") });
    expect(barSpan(tf("1w"), sun)).toEqual({ key: at("2025-03-03T00:00:00Z"), start: at("2025-03-02T00:00:00Z"), end: at("2025-03-10T00:00:00Z") });
    expect(barSpan(tf("1d"), at("2025-03-05T09:00:00Z")).start).toBe(at("2025-03-05T00:00:00Z"));
  });
});

describe("sessions and jumps", () => {
  const london = SESSIONS.find((s) => s.id === "london")!;
  const ny = SESSIONS.find((s) => s.id === "newyork")!;

  it("opens London at 08:00 London time through daylight saving", () => {
    expect(nextSessionOpen(london, at("2025-01-15T03:00:00Z"))).toBe(at("2025-01-15T08:00:00Z")); // GMT
    expect(nextSessionOpen(london, at("2025-07-15T03:00:00Z"))).toBe(at("2025-07-15T07:00:00Z")); // BST
  });

  it("skips the weekend", () => {
    expect(nextSessionOpen(ny, at("2025-03-07T20:00:00Z"))).toBe(at("2025-03-10T12:00:00Z")); // Fri → Mon, EDT from 9 March
    expect(nextDayOpen(at("2025-03-07T10:00:00Z"))).toBe(at("2025-03-10T00:00:00Z"));
  });

  it("lists each weekday's window in a span", () => {
    const w = sessionWindows(SESSIONS[0], at("2025-03-03T00:00:00Z"), at("2025-03-08T00:00:00Z"));
    expect(w.map((x) => x.day)).toEqual(["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"]);
    expect(w[0]).toMatchObject({ start: at("2025-03-03T00:00:00Z"), end: at("2025-03-03T06:00:00Z") }); // 09:00–15:00 JST
  });
});

describe("the forming candle", () => {
  // One UTC day of ticks every 7 seconds from 00:00, a price that wanders.
  const dayStart = at("2025-03-04T00:00:00Z");
  const n = 86_400 / 7;
  const ticks: TickSeries = {
    dayStart, decimals: 3, count: n,
    ms: Int32Array.from({ length: n }, (_, i) => i * 7000),
    bid: Int32Array.from({ length: n }, (_, i) => 2_900_000 + Math.round(Math.sin(i / 37) * 4000 + i)),
    ask: Int32Array.from({ length: n }, (_, i) => 2_900_200 + Math.round(Math.sin(i / 37) * 4000 + i)),
  };
  const m1 = ticksToM1(ticks);

  it("equals the rolled-up minute bars once the candle has closed", () => {
    const t15 = tf("15m");
    const clock = at("2025-03-04T10:14:59Z");
    const span = barSpan(t15, clock);
    const ms = (s: number) => s * 1000;
    const live = joinParts(span.key, 3, foldTicks(ticks, ms(span.start), ms(clock) + 999));
    const closed = forTimeframe(m1, t15);
    const i = closed.time.indexOf(span.key);
    expect(live).toEqual({
      time: span.key, open: closed.open[i] / 1000, high: closed.high[i] / 1000, low: closed.low[i] / 1000,
      close: closed.close[i] / 1000, volume: closed.volume[i],
    });
  });

  it("never contains a tick after the clock", () => {
    const clock = at("2025-03-04T10:07:03Z");
    const part = foldTicks(ticks, at("2025-03-04T10:05:00Z") * 1000, clock * 1000)!;
    const last = Math.floor((clock - dayStart) / 7);
    expect(part.close).toBe(ticks.bid[last]);
    expect(part.volume).toBe(last - Math.ceil((at("2025-03-04T10:05:00Z") - dayStart) / 7) + 1);
  });

  it("joins whole minutes from before today with today's ticks", () => {
    const before = foldBars(m1, at("2025-03-04T00:00:00Z"), at("2025-03-04T12:00:00Z"));
    const after = foldTicks(ticks, at("2025-03-04T12:00:00Z") * 1000, at("2025-03-04T12:30:00Z") * 1000);
    const joined = joinParts(dayStart, 3, before, after)!;
    const direct = joinParts(dayStart, 3, foldTicks(ticks, dayStart * 1000, at("2025-03-04T12:30:00Z") * 1000))!;
    expect(joined).toEqual(direct);
  });
});

describe("closed candles, added a few at a time", () => {
  // Friday, Sunday evening's open and the start of the week after: a tick every
  // 13 seconds while the market is open.
  const day = (iso: string, fromH: number) => {
    const dayStart = at(`${iso}T00:00:00Z`);
    const first = fromH * 3600 * 1000, n = Math.floor((86_400_000 - first) / 13_000);
    const ticks: TickSeries = {
      dayStart, decimals: 3, count: n,
      ms: Int32Array.from({ length: n }, (_, i) => first + i * 13_000),
      bid: Int32Array.from({ length: n }, (_, i) => 2_900_000 + Math.round(Math.sin((dayStart / 13 + i) / 41) * 6000)),
      ask: Int32Array.from({ length: n }, (_, i) => 2_900_150 + Math.round(Math.sin((dayStart / 13 + i) / 41) * 6000)),
    };
    return ticksToM1(ticks);
  };
  const m1 = concatBars([day("2025-03-07", 0), day("2025-03-09", 22), day("2025-03-10", 0), day("2025-03-11", 0)]);
  const from = at("2025-03-07T00:00:00Z"), to = at("2025-03-11T23:59:00Z");

  it("are the same candles as building them all at once, on every timeframe", () => {
    for (const t of timeframes()) {
      const a = barSpan(t, from).start, z = barSpan(t, to).start;
      const whole = closedBetween(m1, t, a, z);
      // Grown one forming candle at a time, as the replay does while playing.
      const grown = [];
      let upTo = a;
      for (let clock = from; clock <= to; clock += 60 * 7) {
        const start = barSpan(t, clock).start;
        if (start > upTo) { grown.push(...closedBetween(m1, t, upTo, start)); upTo = start; }
      }
      grown.push(...closedBetween(m1, t, upTo, z));
      expect(grown, t.key).toEqual(whole);
      // And they match the stored rollup, candle for candle, up to the one forming.
      const all = forTimeframe(m1, t);
      const keep = [...all.time].filter((x) => x < barSpan(t, to).key).length;
      expect(whole.map((c) => c.time), t.key).toEqual([...all.time].slice(0, keep));
    }
  });

  it("folds Sunday evening into Monday's daily candle", () => {
    const d1 = tf("1d");
    const monday = closedBetween(m1, d1, barSpan(d1, at("2025-03-10T12:00:00Z")).start, barSpan(d1, at("2025-03-11T12:00:00Z")).start);
    expect(monday.map((c) => c.time)).toEqual([at("2025-03-10T00:00:00Z")]);
    const sunday = closedBetween(m1, d1, at("2025-03-09T00:00:00Z"), at("2025-03-10T00:00:00Z"));
    expect(sunday.map((c) => c.time)).toEqual([at("2025-03-10T00:00:00Z")]);
    expect(monday[0].volume).toBeGreaterThan(sunday[0].volume);
  });
});

describe("indicators", () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("averages simply and exponentially", () => {
    expect(sma(v, 3).slice(0, 4)).toEqual([null, null, 2, 3]);
    const e = ema(v, 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3, 10); // 2 + 0.5 × (4 − 2)
    expect(emaNext(e[8]!, 10, 3)).toBeCloseTo(e[9]!, 10);
  });

  it("weights VWAP by volume and restarts each day", () => {
    const c = [
      { time: 0, high: 10, low: 10, close: 10, volume: 1 },
      { time: 60, high: 20, low: 20, close: 20, volume: 3 },
      { time: 86_400, high: 5, low: 5, close: 5, volume: 2 },
    ];
    expect(vwap(c)).toEqual([10, 17.5, 5]);
  });
});
