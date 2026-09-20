import { describe, expect, it } from "vitest";
import { tiltProfile } from "../lib/core/tilt";
import { distribution } from "../lib/core/distribution";
import { hourWeekdayGrid, maxDrawdown } from "../lib/core/analysis";
import type { ZoneTrade } from "../lib/core/types";

/** A trade opening at `openMin` minutes past midnight UTC on 18 Sept 2026. */
function t(openMin: number, holdMin: number, pnl: number, lots = 0.1, day = 18): ZoneTrade {
  const openedAt = new Date(Date.UTC(2026, 8, day, 0, openMin));
  const closedAt = new Date(openedAt.getTime() + holdMin * 60_000);
  return {
    id: `${day}-${openMin}-${pnl}`, symbol: "XAUUSD", direction: "long", legs: [],
    openedAt, closedAt, holdMinutes: holdMin, lots,
    avgEntry: 3300, avgExit: 3300, zoneLow: 3300, zoneHigh: 3300, zoneHeight: 0,
    netPnl: pnl, commission: 0, swap: 0, legCount: 1, exitCount: 1,
    closeReasons: ["user"], hadStop: false,
  };
}

describe("tiltProfile", () => {
  /**
   * Twenty-four trades alternating win, loss. After every loss the next trade
   * comes in one minute later at triple size; after every win it comes twenty
   * minutes later at the usual size. That is what tilt looks like in an export.
   */
  function tilted(): ZoneTrade[] {
    const out: ZoneTrade[] = [];
    let at = 60;
    let prev: "win" | "loss" | null = null;
    for (let i = 0; i < 24; i++) {
      // Both the delay before this trade and its size answer the LAST result.
      at += prev === "loss" ? 1 : 20;
      out.push(t(at, 5, i % 2 === 0 ? 20 : -20, prev === "loss" ? 0.3 : 0.1));
      at += 5;
      prev = i % 2 === 0 ? "win" : "loss";
    }
    return out;
  }

  it("sees the re-entry get faster after a loss", () => {
    const r = tiltProfile(tilted(), "UTC")!;
    expect(r).not.toBeNull();
    expect(r.afterLoss.gapMinutes).toBeLessThan(r.afterWin.gapMinutes);
  });

  it("sees the size go up after a loss", () => {
    const r = tiltProfile(tilted(), "UTC")!;
    expect(r.afterLoss.lots).toBeGreaterThan(r.afterWin.lots);
    expect(r.typicalLots).toBeGreaterThan(0);
  });

  it("finds nothing to report when the behaviour is the same either way", () => {
    // Every gap 10 minutes, every size the same, results alternating.
    const steady: ZoneTrade[] = [];
    let at = 60;
    for (let i = 0; i < 30; i++) { steady.push(t(at, 5, i % 2 ? -10 : 10)); at += 15; }
    const r = tiltProfile(steady, "UTC")!;
    expect(r.afterLoss.gapMinutes).toBe(r.afterWin.gapMinutes);
    expect(r.afterLoss.lots).toBe(r.afterWin.lots);
  });

  it("never measures across a night", () => {
    // The gap to tomorrow morning is when the market opened, not a reaction.
    const twoDays = [
      ...Array.from({ length: 15 }, (_, i) => t(60 + i * 15, 5, i % 2 ? -10 : 10, 0.1, 18)),
      ...Array.from({ length: 15 }, (_, i) => t(60 + i * 15, 5, i % 2 ? -10 : 10, 0.1, 21)),
    ];
    const r = tiltProfile(twoDays, "UTC")!;
    // Fourteen measurable gaps a day, none of them fourteen hours long.
    expect(r.afterWin.gapMinutes).toBeLessThan(60);
    expect(r.afterLoss.gapMinutes).toBeLessThan(60);
  });

  it("refuses to report from too few trades", () => {
    expect(tiltProfile([t(60, 5, 10), t(70, 5, -10)], "UTC")).toBeNull();
  });
});

describe("distribution", () => {
  it("never lets a single bin straddle zero", () => {
    const values = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * (1 + (i % 17)));
    const d = distribution(values)!;
    for (const b of d.bins) {
      if (!Number.isFinite(b.from) || !Number.isFinite(b.to)) continue;
      expect(b.from >= 0 || b.to <= 0).toBe(true);
    }
  });

  it("keeps outliers in the end bins instead of letting them set the scale", () => {
    // Ninety-nine small results and one catastrophe.
    const values = [...Array.from({ length: 99 }, () => 5), -5000];
    const d = distribution(values)!;
    expect(d.bins[0].overflow).toBe(true);
    expect(d.bins[0].count).toBe(1);
    expect(d.bins[0].total).toBe(-5000);
    // The scale did not collapse into one column.
    expect(d.bins.filter((b) => b.count > 0).length).toBeGreaterThanOrEqual(2);
  });

  it("measures what the worst few cost against everything the winners made", () => {
    const values = [...Array.from({ length: 95 }, () => 10), ...Array.from({ length: 5 }, () => -200)];
    const d = distribution(values)!;
    expect(d.tailCount).toBe(5);
    expect(d.tailTotal).toBe(-1000);
    expect(d.tailShareOfGross).toBeCloseTo(1000 / 950, 4);
  });

  it("counts every value exactly once", () => {
    const values = Array.from({ length: 300 }, (_, i) => Math.sin(i) * 120);
    const d = distribution(values)!;
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(300);
  });

  it("says nothing from a handful of trades", () => {
    expect(distribution([1, 2, 3])).toBeNull();
  });
});

describe("hourWeekdayGrid", () => {
  it("separates the same hour on different days", () => {
    const g = hourWeekdayGrid([
      t(14 * 60, 5, -50, 0.1, 18),  // Friday
      t(14 * 60, 5, 40, 0.1, 21),   // Monday
    ], "UTC", 2);
    expect(g.days).toEqual(["Monday", "Friday"]);
    expect(g.hours).toEqual([14]);
    expect(g.cells.find((c) => c.day === "Friday")!.net).toBe(-50);
    expect(g.cells.find((c) => c.day === "Monday")!.net).toBe(40);
  });

  it("buckets hours so a phone can show the grid", () => {
    const g = hourWeekdayGrid([t(9 * 60, 5, 1), t(10 * 60, 5, 2)], "UTC", 2);
    expect(g.hours).toEqual([8, 10]);
  });

  it("leaves out hours that were never traded", () => {
    const g = hourWeekdayGrid([t(9 * 60, 5, 1)], "UTC", 2);
    expect(g.hours).toEqual([8]);
    expect(g.cells.length).toBe(1);
  });
});

describe("maxDrawdown", () => {
  const day = (n: number, net: number) => ({ date: `2026-09-${String(n).padStart(2, "0")}`, net });

  it("finds the deepest fall from a high point, not the worst day", () => {
    // Up to 100, then three days down to 30, then back up.
    const d = maxDrawdown([day(1, 100), day(2, -30), day(3, -20), day(4, -20), day(5, 80)])!;
    expect(d.depth).toBe(70);
    expect(d.peakAt).toBe("2026-09-01");
    expect(d.troughAt).toBe("2026-09-04");
    expect(d.days).toBe(3);
  });

  it("says when the account climbed back above the old high", () => {
    const d = maxDrawdown([day(1, 100), day(2, -50), day(3, 20), day(4, 40)])!;
    expect(d.depth).toBe(50);
    expect(d.recoveredAt).toBe("2026-09-04");
  });

  it("reports an unrecovered drawdown as unrecovered rather than omitting it", () => {
    const d = maxDrawdown([day(1, 100), day(2, -60), day(3, 10)])!;
    expect(d.depth).toBe(60);
    expect(d.recoveredAt).toBeNull();
  });

  it("has nothing to say about an account that only went up", () => {
    expect(maxDrawdown([day(1, 10), day(2, 20), day(3, 5)])).toBeNull();
  });
});
