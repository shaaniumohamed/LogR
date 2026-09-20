import { describe, expect, it } from "vitest";
import {
  adjacentTradingDay, monthRange, stepMonth, weeksOfMonth,
} from "../lib/core/calendar";
import { coversFills } from "../lib/core/window";
import { dayShape, tagContrast } from "../lib/core/analysis";
import type { ZoneTrade } from "../lib/core/types";

describe("stepMonth", () => {
  it("moves within a year", () => {
    expect(stepMonth("2026-03", 1)).toBe("2026-04");
    expect(stepMonth("2026-03", -1)).toBe("2026-02");
  });

  it("crosses the year boundary in both directions", () => {
    expect(stepMonth("2026-12", 1)).toBe("2027-01");
    expect(stepMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("monthRange", () => {
  it("includes months that have no trades in them", () => {
    // The point of the whole function: stepping back from October must land in
    // September even when September was a month off.
    expect(monthRange("2026-08", "2026-11")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
  });

  it("is a single month when both ends agree", () => {
    expect(monthRange("2026-05", "2026-05")).toEqual(["2026-05"]);
  });

  it("does not care which way round the arguments come", () => {
    expect(monthRange("2026-11", "2026-09")).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});

describe("weeksOfMonth", () => {
  it("pads the first and last weeks rather than shifting the dates", () => {
    // 1 September 2026 is a Tuesday, so Monday's slot is empty.
    const weeks = weeksOfMonth("2026-09");
    expect(weeks[0].days[0]).toBeNull();
    expect(weeks[0].days[1]).toBe("2026-09-01");
    expect(weeks.at(-1)!.days.filter(Boolean).at(-1)).toBe("2026-09-30");
  });

  it("covers every day of the month exactly once", () => {
    // February in a leap year and out of one, a 30-day month and a 31-day one.
    for (const [ym, length] of [["2026-02", 28], ["2024-02", 29], ["2026-09", 30], ["2026-08", 31]] as const) {
      const days = weeksOfMonth(ym).flatMap((w) => w.days).filter(Boolean);
      expect(days.length).toBe(length);
      expect(new Set(days).size).toBe(length);
      expect(days[0]).toBe(`${ym}-01`);
      expect(days.at(-1)).toBe(`${ym}-${length}`);
    }
  });

  it("starts every row on a Monday", () => {
    for (const w of weeksOfMonth("2026-09")) {
      expect(new Date(`${w.key}T12:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe("adjacentTradingDay", () => {
  const days = ["2026-09-14", "2026-09-15", "2026-09-18", "2026-09-21"];

  it("skips the days that were not traded", () => {
    // Friday the 18th to Monday the 21st, with the weekend never offered.
    expect(adjacentTradingDay(days, "2026-09-18", 1)).toBe("2026-09-21");
    expect(adjacentTradingDay(days, "2026-09-21", -1)).toBe("2026-09-18");
  });

  it("returns null at either end", () => {
    expect(adjacentTradingDay(days, "2026-09-21", 1)).toBeNull();
    expect(adjacentTradingDay(days, "2026-09-14", -1)).toBeNull();
  });

  it("works from a day that has no trades of its own", () => {
    expect(adjacentTradingDay(days, "2026-09-19", -1)).toBe("2026-09-18");
    expect(adjacentTradingDay(days, "2026-09-19", 1)).toBe("2026-09-21");
  });
});

describe("coversFills", () => {
  // A run of ten consecutive minutes, then a long silence, then one more.
  const minute = (m: number) => ({ time: m * 60 });
  const bars = [...Array.from({ length: 10 }, (_, i) => minute(100 + i)), minute(400)];

  it("calls a fill covered when a candle sits on its own minute", () => {
    expect(coversFills(bars, [minute(104)])).toEqual({ covered: 1, total: 1, complete: true });
  });

  it("tolerates a short hole in the feed", () => {
    // Minute 111 has no bar of its own, but 110 does — the fill is still in the
    // picture, and a one-minute gap in a thin market is normal, not missing data.
    expect(coversFills(bars, [minute(111)]).covered).toBe(1);
  });

  it("reports a fill nowhere near any candle as uncovered", () => {
    expect(coversFills(bars, [minute(250)])).toEqual({ covered: 0, total: 1, complete: false });
  });

  it("counts partial coverage rather than calling the chart empty", () => {
    const r = coversFills(bars, [minute(100), minute(250), minute(400)]);
    expect(r).toEqual({ covered: 2, total: 3, complete: false });
  });

  it("does not stretch the slack further than it was given", () => {
    expect(coversFills(bars, [minute(112)]).covered).toBe(0);
  });

  it("is not complete when there are no candles at all", () => {
    expect(coversFills([], [minute(1)]).complete).toBe(false);
  });
});

function trade(minute: number, pnl: number): ZoneTrade {
  const closedAt = new Date(Date.UTC(2026, 8, 18, 0, minute));
  return {
    id: `t${minute}`, symbol: "XAUUSD", direction: "long", legs: [],
    openedAt: new Date(closedAt.getTime() - 60_000), closedAt,
    holdMinutes: 1, lots: 0.01, avgEntry: 3000, avgExit: 3000,
    zoneLow: 3000, zoneHigh: 3000, zoneHeight: 0, netPnl: pnl,
    commission: 0, swap: 0, legCount: 1, exitCount: 1, closeReasons: ["user"], hadStop: false,
  };
}

describe("dayShape", () => {
  it("finds the high point of the day, not just its total", () => {
    // Up 300, then handed 260 of it back. The total alone says +40.
    const s = dayShape([trade(10, 300), trade(20, -160), trade(30, -100)]);
    expect(s.peak).toBe(300);
    expect(s.close).toBe(40);
    expect(s.gaveBack).toBe(260);
    expect(s.gaveBackMost).toBe(true);
  });

  it("does not call a steady climb a give-back", () => {
    const s = dayShape([trade(10, 20), trade(20, 20)]);
    expect(s.gaveBack).toBe(0);
    expect(s.gaveBackMost).toBe(false);
  });

  it("orders by exit however the trades arrive", () => {
    const s = dayShape([trade(30, -100), trade(10, 300), trade(20, -160)]);
    expect(s.curve).toEqual([300, 140, 40]);
  });

  it("measures the fall from the best point even on a day that never went green", () => {
    // Down 50 at its best, finished down 70. The fall is real and worth showing,
    // but it is not profit handed back, so the loud flag stays off.
    const s = dayShape([trade(10, -50), trade(20, -20)]);
    expect(s.peak).toBe(-50);
    expect(s.gaveBack).toBe(20);
    expect(s.gaveBackMost).toBe(false);
    expect(s.worst).toBe(-70);
  });

  it("is empty-safe", () => {
    expect(dayShape([]).curve).toEqual([]);
    expect(dayShape([]).peakAt).toBeNull();
  });
});

describe("tagContrast", () => {
  const items = [
    { won: true, tags: ["fresh_level", "htf_bias"] },
    { won: true, tags: ["fresh_level", "htf_bias"] },
    { won: true, tags: ["fresh_level", "htf_bias"] },
    { won: true, tags: ["htf_bias"] },
    { won: false, tags: ["htf_bias"] },
    { won: false, tags: ["htf_bias"] },
    { won: false, tags: ["htf_bias"] },
    { won: false, tags: ["htf_bias", "fresh_level"] },
  ];

  it("separates a tag that predicts from one that is merely everywhere", () => {
    const [top] = tagContrast(items, 4);
    // Fresh level: on 3 of 4 winners, 1 of 4 losers. HTF bias is on all eight.
    expect(top.key).toBe("fresh_level");
    expect(top.inWinners).toBe(0.75);
    expect(top.inLosers).toBe(0.25);
    expect(top.lift).toBe(0.5);
  });

  it("gives a tag present on everything a lift of zero", () => {
    const htf = tagContrast(items, 4).find((t) => t.key === "htf_bias")!;
    expect(htf.lift).toBe(0);
    expect(htf.seen).toBe(8);
  });

  it("leaves out tags used too rarely to mean anything", () => {
    const withRare = [...items, { won: true, tags: ["judas"] }];
    expect(tagContrast(withRare, 4).some((t) => t.key === "judas")).toBe(false);
    expect(tagContrast(withRare, 1).some((t) => t.key === "judas")).toBe(true);
  });

  it("counts a tag once however often it appears on one trade", () => {
    const dupes = [
      { won: true, tags: ["fvg", "fvg", "fvg"] },
      { won: false, tags: ["fvg"] },
    ];
    const [fvg] = tagContrast(dupes, 1);
    expect(fvg.winners).toBe(1);
    expect(fvg.seen).toBe(2);
  });

  it("says nothing at all when every trade went the same way", () => {
    expect(tagContrast([{ won: true, tags: ["a"] }, { won: true, tags: ["a"] }], 1)).toEqual([]);
  });
});
