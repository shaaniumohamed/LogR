import { describe, expect, it } from "vitest";
import { cleanDrawings, drawingBand, indexToTime, magnet, timeToIndex, DRAWINGS_MAX } from "@/lib/core/drawings";
import type { Drawing } from "@/lib/core/types";

const NOW = Date.UTC(2026, 9, 1);
const T = 1_780_000_020; // a minute boundary in 2026

describe("cleanDrawings", () => {
  it("keeps the old price-only drawings exactly as they were", () => {
    const old = [
      { id: "a", kind: "zone", low: 3310, high: 3300, label: "Demand zone" },
      { id: "b", kind: "level", low: 3320, high: 3320, label: "Target" },
    ];
    expect(cleanDrawings(old, NOW)).toEqual([
      { id: "a", kind: "zone", low: 3300, high: 3310, label: "Demand zone" },
      { id: "b", kind: "level", low: 3320, high: 3320, label: "Target" },
    ]);
  });

  it("keeps boxes, trend lines and notes pinned to candles", () => {
    const got = cleanDrawings([
      { id: "x", kind: "box", t1: T, p1: 3300, t2: T + 600, p2: 3305, label: "Order block", color: "green", extend: true },
      { id: "y", kind: "trend", t1: T, p1: 3300, t2: T + 600, p2: 3310, label: "" },
      { id: "z", kind: "note", t1: T, p1: 3301.5, label: "  swept the   Asian low ", color: "blue" },
    ], NOW);
    expect(got).toEqual([
      { id: "x", kind: "box", t1: T, p1: 3300, t2: T + 600, p2: 3305, label: "Order block", color: "green", extend: true },
      { id: "y", kind: "trend", t1: T, p1: 3300, t2: T + 600, p2: 3310, label: "" },
      { id: "z", kind: "note", t1: T, p1: 3301.5, label: "swept the Asian low", color: "blue" },
    ]);
  });

  it("drops anything that would break the chart", () => {
    const got = cleanDrawings([
      null, "nope", 42,
      { id: "nan", kind: "level", low: NaN, high: NaN, label: "" },
      { id: "neg", kind: "zone", low: -1, high: 5, label: "" },
      { id: "kind", kind: "circle", low: 1, high: 2, label: "" },
      { id: "old", kind: "note", t1: 100, p1: 3300, label: "1970" },
      { id: "future", kind: "note", t1: NOW / 1000 + 400 * 86_400, p1: 3300, label: "too far" },
      { id: "frac", kind: "box", t1: T + 0.5, p1: 1, t2: T, p2: 2, label: "" },
      { id: "empty", kind: "note", t1: T, p1: 3300, label: "   " },
      { id: "", kind: "level", low: 1, high: 1, label: "no id" },
    ], NOW);
    expect(got).toEqual([]);
  });

  it("drops a duplicate id, an unknown colour, and caps the count and the text", () => {
    const many = Array.from({ length: DRAWINGS_MAX + 5 }, (_, i) => ({ id: `d${i}`, kind: "level", low: 1 + i, high: 1 + i, label: "" }));
    expect(cleanDrawings(many, NOW)).toHaveLength(DRAWINGS_MAX);

    const got = cleanDrawings([
      { id: "a", kind: "level", low: 1, high: 1, label: "x".repeat(100), color: "pink" },
      { id: "a", kind: "level", low: 2, high: 2, label: "again" },
    ], NOW);
    expect(got).toHaveLength(1);
    expect(got[0].label).toHaveLength(40);
    expect(got[0]).not.toHaveProperty("color");
  });

  it("returns nothing for something that is not a list", () => {
    expect(cleanDrawings({ id: "a" }, NOW)).toEqual([]);
    expect(cleanDrawings(undefined, NOW)).toEqual([]);
  });
});

describe("drawingBand", () => {
  it("gives a band for zones, lines and boxes, and none for trend lines and notes", () => {
    const d = (x: object) => x as Drawing;
    expect(drawingBand(d({ kind: "zone", low: 5, high: 3 }))).toEqual({ low: 3, high: 5 });
    expect(drawingBand(d({ kind: "level", low: 4, high: 4 }))).toEqual({ low: 4, high: 4 });
    expect(drawingBand(d({ kind: "box", t1: T, p1: 9, t2: T, p2: 7 }))).toEqual({ low: 7, high: 9 });
    expect(drawingBand(d({ kind: "trend", t1: T, p1: 9, t2: T, p2: 7 }))).toBeNull();
    expect(drawingBand(d({ kind: "note", t1: T, p1: 9, label: "x" }))).toBeNull();
  });
});

describe("time ↔ candle index", () => {
  // Five-minute candles with a gap (a halt) between the third and fourth.
  const times = [T, T + 300, T + 600, T + 3600, T + 3900];

  it("puts a candle's own time on that candle", () => {
    times.forEach((t, i) => expect(timeToIndex(times, 300, t)).toBe(i));
  });

  it("puts a time inside a candle partway through it", () => {
    expect(timeToIndex(times, 300, T + 60)).toBeCloseTo(0.2);
    expect(timeToIndex(times, 300, T + 3960)).toBeCloseTo(4.2);
  });

  it("holds a time in a gap at the next candle instead of floating", () => {
    expect(timeToIndex(times, 300, T + 2000)).toBe(3);
  });

  it("extends past either end one candle per bucket", () => {
    expect(timeToIndex(times, 300, T - 600)).toBe(-2);
    expect(timeToIndex(times, 300, T + 3900 + 900)).toBe(7);
    expect(indexToTime(times, 300, -2)).toBe(T - 600);
    expect(indexToTime(times, 300, 7)).toBe(T + 3900 + 900);
  });

  it("snaps an index to the open time of the nearest candle", () => {
    expect(indexToTime(times, 300, 2.4)).toBe(T + 600);
    expect(indexToTime(times, 300, 2.6)).toBe(T + 3600);
  });

  it("lands a one-minute note inside its candle on a coarser chart", () => {
    // 09:07 on one-minute candles, viewed on fifteen-minute candles from 09:00.
    const fifteen = [T, T + 900, T + 1800];
    const i = timeToIndex(fifteen, 900, T + 7 * 60);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(1);
  });
});

describe("magnet", () => {
  const bar = { open: 100, high: 110, low: 90, close: 105 };
  const toY = (p: number) => (200 - p) * 4; // 4px per dollar

  it("pulls a tap within a fingertip onto the candle's open, high, low or close", () => {
    expect(magnet(104.2, bar, toY)).toBe(105); // 3.2px from the close
    expect(magnet(109, bar, toY)).toBe(110);   // 4px from the high
  });

  it("leaves a tap alone when nothing is close", () => {
    expect(magnet(97, bar, toY)).toBe(97);     // 12px from the open, 28px from the low
    expect(magnet(97, undefined, toY)).toBe(97);
  });
});
