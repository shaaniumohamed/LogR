import { describe, expect, it } from "vitest";
import { findLeaks, welchT, LEAK_MIN } from "@/lib/core/leaks";
import type { ZoneTrade } from "@/lib/core/types";

/**
 * The ranking that puts a trader's most expensive habits first.
 *
 * The test that matters most is the second one. In an account that loses
 * overall, nearly every group of trades lost money, and a naive ranking would
 * hand back the biggest groups dressed up as habits. A group that loses at the
 * same rate as everything else is not a leak, however large its total.
 */
let seq = 0;
/** A trade at a given UTC hour on a given day, with a given result. */
function trade(day: number, hour: number, net: number, extra: Partial<ZoneTrade> = {}): ZoneTrade {
  const openedAt = new Date(Date.UTC(2026, 5, 1 + day, hour, (seq * 7) % 50));
  return {
    id: `t${seq++}`, symbol: "XAUUSD", direction: "long", legs: [],
    openedAt, closedAt: new Date(openedAt.getTime() + 5 * 60_000),
    holdMinutes: 5, lots: 0.1, avgEntry: 3000, avgExit: 3001, zoneLow: 3000, zoneHigh: 3000, zoneHeight: 0,
    netPnl: net, commission: 0, swap: 0, legCount: 1, exitCount: 1,
    ...extra,
  } as ZoneTrade;
}

/** Noise: results that average `avg` with a realistic spread. */
const jitter = (i: number, avg: number) => avg + ((i * 37) % 21) - 10;

describe("findLeaks", () => {
  it("names an hour that is genuinely worse than the rest", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 40; d++) {
      for (const h of [8, 10, 13, 15]) trades.push(trade(d, h, jitter(d + h, 2)));
      trades.push(trade(d, 4, jitter(d, -14)));
    }
    const leaks = findLeaks({ trades, timeZone: "UTC" });
    expect(leaks[0].title).toBe("Trading at 04:00");
    expect(leaks[0].strength).toBe("clear");
    expect(leaks[0].cost).toBeGreaterThan(0);
  });

  it("does not call a group a leak just because the whole account loses", () => {
    // Every hour loses at the same rate. The 04:00 bucket lost money in total,
    // and is the same size as the others, but it is no worse than anything
    // else the trader did — there is no habit here to break.
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 40; d++) {
      for (const h of [4, 8, 10, 13, 15]) trades.push(trade(d, h, jitter(d * 5 + h, -3)));
    }
    const leaks = findLeaks({ trades, timeZone: "UTC" });
    expect(leaks.find((l) => l.family === "hour")).toBeUndefined();
  });

  it("ignores a group too small to mean anything", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 40; d++) trades.push(trade(d, 10, jitter(d, 2)));
    for (let d = 0; d < LEAK_MIN - 1; d++) trades.push(trade(d, 4, -200));
    const leaks = findLeaks({ trades, timeZone: "UTC" });
    expect(leaks.find((l) => l.key === "hour:4")).toBeUndefined();
  });

  it("never ranks a group that made money", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 40; d++) {
      trades.push(trade(d, 10, jitter(d, 20)));
      trades.push(trade(d, 4, jitter(d, 1)));
    }
    const leaks = findLeaks({ trades, timeZone: "UTC" });
    expect(leaks.find((l) => l.key === "hour:4")).toBeUndefined();
  });

  it("names one hour, not five neighbouring ones", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 40; d++) {
      for (const h of [8, 10, 13, 15, 16, 17]) trades.push(trade(d, h, jitter(d + h, 3)));
      for (const h of [2, 3, 4]) trades.push(trade(d, h, jitter(d + h, -12)));
    }
    const hours = findLeaks({ trades, timeZone: "UTC" }, 10).filter((l) => l.family === "hour");
    expect(hours.length).toBe(1);
  });

  it("finds jumping back in after a loss — but only after a loss that had closed", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 30; d++) {
      // A loss at 10:00, closed at 10:05, then a re-entry two minutes later
      // that loses badly.
      const loss = trade(d, 10, -5);
      const reentry = trade(d, 10, -25, {
        openedAt: new Date(loss.closedAt.getTime() + 2 * 60_000),
        closedAt: new Date(loss.closedAt.getTime() + 8 * 60_000),
      });
      trades.push(loss, reentry);
      for (const h of [13, 15, 17]) trades.push(trade(d, h, jitter(d + h, 4)));
    }
    const leak = findLeaks({ trades, timeZone: "UTC" }, 10).find((l) => l.family === "afterLoss");
    expect(leak?.n).toBe(30);
  });

  it("does not count an overlapping trade as a reaction to a loss that had not closed yet", () => {
    const trades: ZoneTrade[] = [];
    for (let d = 0; d < 30; d++) {
      // Opened BEFORE the losing trade closed: it cannot be a reaction to it.
      const loss = trade(d, 10, -5);
      const overlap = trade(d, 10, -25, {
        openedAt: new Date(loss.openedAt.getTime() + 60_000),
        closedAt: new Date(loss.closedAt.getTime() + 60_000),
      });
      trades.push(loss, overlap);
      for (const h of [13, 15, 17]) trades.push(trade(d, h, jitter(d + h, 4)));
    }
    const leak = findLeaks({ trades, timeZone: "UTC" }, 10).find((l) => l.family === "afterLoss");
    expect(leak).toBeUndefined();
  });

  it("reads tags when there are annotations", () => {
    const trades: ZoneTrade[] = [];
    const annotations = new Map<string, { emotion: string }>();
    for (let d = 0; d < 40; d++) {
      const calm = trade(d, 10, jitter(d, 4));
      const rushed = trade(d, 13, jitter(d, -11));
      trades.push(calm, rushed);
      annotations.set(calm.id, { emotion: "patient" });
      annotations.set(rushed.id, { emotion: "rushed" });
    }
    const leaks = findLeaks({
      trades, timeZone: "UTC", annotations,
      label: { feeling: (k) => (k === "rushed" ? "Rushed" : "Patient") },
    }, 10);
    const feeling = leaks.find((l) => l.family === "feeling");
    expect(feeling?.title).toBe("Trading while rushed");
    expect(feeling?.filter).toEqual({ emotion: "rushed" });
  });
});

describe("welchT", () => {
  it("is strongly negative for a clearly worse group and near zero for the same one", () => {
    const worse = Array.from({ length: 40 }, (_, i) => -10 + (i % 5));
    const better = Array.from({ length: 40 }, (_, i) => 5 + (i % 5));
    expect(welchT(worse, better)).toBeLessThan(-5);
    expect(Math.abs(welchT(better, better))).toBeLessThan(0.001);
  });
});
