import { describe, expect, it } from "vitest";
import { heldOverWeekend } from "../lib/core/analysis";
import { computeStats, costPicture, hourIn, localDayKey } from "../lib/core/metrics";
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
    const c = costPicture(100, 10); // 10 lots, $0.15–0.30/oz
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
