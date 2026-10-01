import { describe, expect, it } from "vitest";
import { comebacks, excursion, keptShare, type Bar, type Leg } from "@/lib/core/excursion";

/**
 * Heat taken and room given, with the position actually held at each minute.
 * $100 per 1.00 of price per lot, which is gold's arithmetic on a standard lot.
 */
const PV = 100;
const T0 = Date.UTC(2026, 5, 1, 10, 0) / 1000;
const at = (min: number, sec = 0) => new Date((T0 + min * 60 + sec) * 1000);
const bar = (min: number, open: number, high: number, low: number, close: number): Bar =>
  ({ time: T0 + min * 60, open, high, low, close });
const leg = (o: number, c: number, lots: number, op: number, cp: number, dir: "long" | "short" = "long"): Leg => ({
  openedAt: at(o, 10), closedAt: at(c, 20), lots, openPrice: op, closePrice: cp, direction: dir,
  profit: (cp - op) * (dir === "long" ? 1 : -1) * lots * PV,
});

describe("excursion", () => {
  it("measures the worst and best of the minutes the trade was open", () => {
    const bars = [bar(0, 100, 100.3, 99.9, 100.1), bar(1, 100.1, 101, 99, 99.5), bar(2, 99.5, 100.5, 98.5, 100), bar(3, 100, 100.4, 100, 100.2)];
    const x = excursion([leg(0, 3, 1, 100, 100.2)], bars, PV)!;
    expect(x.heat).toBeCloseTo(-150);   // 98.50 in minute 2
    expect(x.best).toBeCloseTo(100);    // 101.00 in minute 1
    expect(x.final).toBeCloseTo(20);
  });

  it("does not count prices from before the fill in the minute you entered", () => {
    // The entry minute's low is far below, but it may have printed before the
    // buy — only the fill and that minute's close are certain.
    const bars = [bar(0, 95, 100.2, 90, 100.1), bar(1, 100.1, 100.3, 100, 100.2)];
    const x = excursion([leg(0, 1, 1, 100, 100.2)], bars, PV)!;
    expect(x.heat).toBe(0);
  });

  it("does not count prices from after the exit in the minute you left", () => {
    const bars = [bar(0, 100, 100.1, 100, 100.05), bar(1, 100.05, 100.1, 100, 100.1), bar(2, 100.1, 115, 100.1, 114)];
    const x = excursion([leg(0, 2, 1, 100, 100.1)], bars, PV)!;
    expect(x.best).toBeLessThan(20); // not the 115 spike after the exit
  });

  it("carries only the size actually on — a ladder is small before it fills", () => {
    // 0.1 lot from minute 0, a second 0.1 added in minute 3. The dip in minute
    // 1 happened with only the first leg on.
    const bars = [
      bar(0, 100, 100, 100, 100), bar(1, 100, 100, 98, 99), bar(2, 99, 99.5, 99, 99.2),
      bar(3, 99.2, 99.3, 99, 99.1), bar(4, 99.1, 101, 99.1, 100.8), bar(5, 100.8, 101, 100.5, 101),
    ];
    const x = excursion([leg(0, 5, 0.1, 100, 101), leg(3, 5, 0.1, 99.1, 101)], bars, PV)!;
    // Worst moment: minute 1 at 98 with 0.1 lots on → -20, not -40.
    expect(x.heat).toBeCloseTo(-20);
  });

  it("banks a partial, so it stops moving with price", () => {
    const bars = [
      bar(0, 100, 100, 100, 100), bar(1, 100, 102, 100, 102), bar(2, 102, 102, 101.9, 102),
      bar(3, 102, 102, 99, 99.5), bar(4, 99.5, 100, 99.5, 100),
    ];
    // Half taken off at 102 in minute 2; the rest rides back to 100.
    const x = excursion([leg(0, 2, 0.5, 100, 102), leg(0, 4, 0.5, 100, 100)], bars, PV)!;
    // Minute 3 low of 99: banked +100 from the partial, -50 on the half still on.
    expect(x.heat).toBe(0);
    expect(x.path.find((p) => p.time === T0 + 180)!.lo).toBeCloseTo(50);
  });

  it("is the mirror image for a short", () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 101.5, 99, 99.2), bar(2, 99.2, 99.5, 99, 99)];
    const x = excursion([leg(0, 2, 1, 100, 99, "short")], bars, PV)!;
    expect(x.heat).toBeCloseTo(-150); // 101.50 against a short
    expect(x.best).toBeCloseTo(100);
  });

  it("says nothing when most of the minutes are missing", () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(9, 100, 100, 100, 100)];
    expect(excursion([leg(0, 9, 1, 100, 100)], bars, PV)).toBeNull();
  });

  it("reports how much of the best moment was kept", () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 104, 100, 103), bar(2, 103, 103, 101, 101)];
    const x = excursion([leg(0, 2, 1, 100, 101)], bars, PV)!;
    expect(keptShare(x)).toBeCloseTo(100 / 400);
  });
});

describe("comebacks", () => {
  it("buckets by how far price went against the first entry", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ adversePrice: i / 10, final: i < 25 ? 10 : -10 }));
    const rows = comebacks(items, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].green).toBe(10);
    expect(rows[4].green).toBe(0);
  });
});
