import { describe, expect, it } from "vitest";
import { heldOverWeekend, sessionOf } from "../lib/core/analysis";
import { computeStats, costPicture, hourIn, localDayKey, pointValuePerLot } from "../lib/core/metrics";
import type { ZoneTrade } from "../lib/core/types";

const zt = (netPnl: number, holdMinutes = 5, lots = 0.01): ZoneTrade => ({
  id: Math.random().toString(36), symbol: "XAUUSD", direction: "long", legs: [],
  openedAt: new Date(), closedAt: new Date(), holdMinutes, lots,
  avgEntry: 0, avgExit: 0, zoneLow: 0, zoneHigh: 0, zoneHeight: 0,
  netPnl, commission: 0, swap: 0, legCount: 1, exitCount: 1, closeReasons: ["user"], hadStop: false,
});

describe("computeStats", () => {
  it("computes the break-even win rate from the payoff ratio", () => {
    // avg win 1, avg loss 1 → payoff 1 → you need 50% just to stand still.
    const s = computeStats([zt(1), zt(1), zt(-1), zt(-1)]);
    expect(s.payoff).toBeCloseTo(1, 6);
    expect(s.breakEvenWinRate).toBeCloseTo(0.5, 6);
    expect(s.edgePoints).toBeCloseTo(0, 6);
  });

  it("exposes a win rate that looks good but is break-even", () => {
    // 3 wins of 1, 2 losses of 1.5 → 60% win rate, payoff 0.667, break-even 60%.
    const s = computeStats([zt(1), zt(1), zt(1), zt(-1.5), zt(-1.5)]);
    expect(s.winRate).toBeCloseTo(0.6, 6);
    expect(s.breakEvenWinRate).toBeCloseTo(0.6, 6);
    expect(s.edgePoints).toBeCloseTo(0, 6);
    expect(s.net).toBe(0);
  });

  it("keeps scratch trades out of the win rate but counts them", () => {
    const s = computeStats([zt(1), zt(-1), zt(0), zt(0.001)]);
    expect(s.n).toBe(4);
    expect(s.scratches).toBe(2);
    expect(s.winRate).toBeCloseTo(0.5, 6);
  });

  it("returns null rather than Infinity when there are no losses", () => {
    const s = computeStats([zt(1), zt(2)]);
    expect(s.profitFactor).toBeNull();
    expect(s.payoff).toBeNull();
    expect(s.breakEvenWinRate).toBeNull();
  });

  it("handles an empty set", () => {
    expect(computeStats([]).n).toBe(0);
  });
});

describe("costPicture", () => {
  it("frames spread against gross edge, not against net profit", () => {
    // The spread is inside the fill, so net is ALREADY after it. Gross edge is
    // net + spread, and the honest figure is the share of gross edge kept.
    // 10 lots of gold: $0.15–0.30 an ounce, 100 ounces to the lot.
    const c = costPicture(100, 10, 0.15, 0.3, 100);
    expect(c.costLo).toBe(150);
    expect(c.costHi).toBe(300);
    expect(c.grossLo).toBe(250);
    expect(c.grossHi).toBe(400);
    expect(c.keptLo!).toBeCloseTo(100 / 400, 6);
    expect(c.keptHi!).toBeCloseTo(100 / 250, 6);
  });
});

describe("timezone helpers", () => {
  it("converts a UTC timestamp to the trader's local hour", () => {
    // 13:00 UTC is 21:00 in Malaysia — the difference between an abstraction
    // and something the trader can actually act on.
    const d = new Date("2026-09-18T13:30:00Z");
    expect(hourIn(d, "Asia/Kuala_Lumpur")).toBe(21);
    expect(hourIn(d, "UTC")).toBe(13);
  });

  it("rolls the local day over correctly", () => {
    const d = new Date("2026-09-18T18:00:00Z"); // 02:00 next day in MYT
    expect(localDayKey(d, "Asia/Kuala_Lumpur")).toBe("2026-09-19");
    expect(localDayKey(d, "UTC")).toBe("2026-09-18");
  });
});

describe("heldOverWeekend", () => {
  const at = (d: number, h: number) => new Date(Date.UTC(2026, 8, d, h));
  // 2026-09-18 is a Friday, 19 Saturday, 20 Sunday, 21 Monday.

  it("catches a Friday evening entry that closed after the weekend", () => {
    // The trade this exists for: entered near the close, reopened elsewhere.
    expect(heldOverWeekend(at(18, 20), at(21, 1))).toBe(true);
  });

  it("leaves a Friday trade closed the same evening alone", () => {
    expect(heldOverWeekend(at(18, 20), at(18, 23))).toBe(false);
  });

  it("leaves a midweek hold alone however long", () => {
    expect(heldOverWeekend(at(14, 9), at(17, 9))).toBe(false);
  });

  it("catches a hold that spans more than one week", () => {
    expect(heldOverWeekend(at(14, 9), at(23, 9))).toBe(true);
  });

  it("counts a position still open at any point on Saturday", () => {
    expect(heldOverWeekend(at(18, 23), at(19, 1))).toBe(true);
  });
});

describe("pointValuePerLot", () => {
  const priced = (entry: number, exit: number, lots: number, pnl: number, dir: "long" | "short" = "long"): ZoneTrade => ({
    id: `${entry}-${exit}-${lots}-${pnl}`, symbol: "XAUUSD", direction: dir, legs: [],
    openedAt: new Date(0), closedAt: new Date(60_000), holdMinutes: 1, lots,
    avgEntry: entry, avgExit: exit, zoneLow: entry, zoneHigh: entry, zoneHeight: 0,
    netPnl: pnl, commission: 0, swap: 0, legCount: 1, exitCount: 1,
    closeReasons: ["user"], hadStop: false,
  });

  it("recovers gold's hundred ounces a lot from the fills alone", () => {
    // 1.00 of price on 0.10 lots making $10 can only mean $100 a point a lot.
    const trades = Array.from({ length: 25 }, (_, i) => priced(3300, 3301, 0.1, 10 + i * 0));
    expect(pointValuePerLot(trades)).toBeCloseTo(100, 6);
  });

  it("recovers a currency pair's hundred thousand just as well", () => {
    const trades = Array.from({ length: 25 }, () => priced(1.08, 1.081, 0.1, 10));
    expect(pointValuePerLot(trades)).toBeCloseTo(100_000, 0);
  });

  it("reads a short the right way round", () => {
    const trades = Array.from({ length: 25 }, () => priced(3301, 3300, 0.1, 10, "short"));
    expect(pointValuePerLot(trades)).toBeCloseTo(100, 6);
  });

  it("is not dragged off by a handful of fee-dominated scratches", () => {
    const good = Array.from({ length: 25 }, () => priced(3300, 3301, 0.1, 10));
    const scratchy = Array.from({ length: 5 }, () => priced(3300, 3300.01, 0.1, 0.02));
    expect(pointValuePerLot([...good, ...scratchy])).toBeCloseTo(100, 6);
  });

  it("refuses to answer from too few trades rather than guessing", () => {
    expect(pointValuePerLot([priced(3300, 3301, 0.1, 10)])).toBeNull();
    expect(pointValuePerLot([])).toBeNull();
  });

  it("ignores trades that did not move, which say nothing about scale", () => {
    const flat = Array.from({ length: 30 }, () => priced(3300, 3300, 0.1, -0.5));
    expect(pointValuePerLot(flat)).toBeNull();
  });
});

describe("sessionOf", () => {
  const at = (utcHour: number) => new Date(Date.UTC(2026, 8, 16, utcHour, 30));

  it("names the session from UTC, not from wherever the trader is sitting", () => {
    // The bug this replaced: at UTC+8 a local hour of 03:00 is 19:00 UTC, the
    // New York afternoon, and it was being filed under Asia.
    expect(sessionOf(at(19))).toBe("New York");
    expect(sessionOf(at(3))).toBe("Asia");
    expect(sessionOf(at(9))).toBe("London");
    expect(sessionOf(at(22))).toBe("Late");
  });

  it("covers the whole clock with no gaps", () => {
    const seen = new Set(Array.from({ length: 24 }, (_, h) => sessionOf(at(h))));
    expect([...seen].sort()).toEqual(["Asia", "Late", "London", "New York"]);
  });
});
