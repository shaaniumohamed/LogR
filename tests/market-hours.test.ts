import { describe, expect, it } from "vitest";
import {
  caughtByClose, closuresIn, leftBucket, sessionLeftAt,
} from "@/lib/core/market-hours";

const H = 3600;
/** 2026-01-05 is a Monday. Bars are stamped at the start of their hour. */
const MON = Math.floor(Date.UTC(2026, 0, 5, 0, 0, 0) / 1000);

/**
 * A week of hourly bars with gold's shape: open all day, dark for one hour
 * every night at 22:00 UTC, and shut from Friday night to Sunday night.
 */
function week(days = 5, breakHour = 22): { time: number }[] {
  const bars: { time: number }[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      if (h === breakHour) continue;
      bars.push({ time: MON + d * 24 * H + h * H });
    }
  }
  return bars;
}

describe("closuresIn", () => {
  it("finds the nightly break and puts its start at the end of the last bar", () => {
    const c = closuresIn(week());
    const nightly = c.filter((x) => !x.weekend);
    expect(nightly.length).toBe(5);
    // The 21:00 bar covers 21:00–22:00, so trading stopped at 22:00 — not 21:00.
    expect(new Date(nightly[0].startSec * 1000).getUTCHours()).toBe(22);
    expect(nightly[0].hours).toBe(1);
  });

  it("does not believe a one-off hole, which is what a missing bar looks like", () => {
    const bars = week().filter((b) => b.time !== MON + 2 * 24 * H + 10 * H);
    const invented = closuresIn(bars).filter(
      (c) => new Date(c.startSec * 1000).getUTCHours() === 11
    );
    expect(invented).toEqual([]);
  });

  it("believes a weekend on sight, since nothing else goes dark that long", () => {
    const bars = [...week(5), { time: MON + 7 * 24 * H }];
    const weekend = closuresIn(bars).filter((c) => c.weekend);
    expect(weekend.length).toBe(1);
    expect(weekend[0].hours).toBeGreaterThan(12);
  });
});

describe("sessionLeftAt", () => {
  const closures = closuresIn(week());

  it("counts the minutes to the next close, not to the last bar", () => {
    const at = MON + 21 * H + 40 * 60; // 21:40, twenty minutes before 22:00
    expect(sessionLeftAt(at, closures)?.minutesLeft).toBe(20);
  });

  it("says nothing rather than something wrong when a break is missing from the data", () => {
    // Bars with the Tuesday break filled in: the next real closure is then more
    // than a day away, which cannot happen to a gold trader.
    const at = MON + 23 * H;
    const sparse = closures.filter((c) => c.startSec > at + 30 * 3600);
    expect(sessionLeftAt(at, sparse)).toBeNull();
  });

  it("has nothing to say about a trade after the last closure it knows of", () => {
    expect(sessionLeftAt(MON + 30 * 24 * H, closures)).toBeNull();
  });
});

describe("leftBucket", () => {
  it("separates the short end, where this account's holds actually live", () => {
    expect(leftBucket(3)).toBe("under 15 minutes");
    expect(leftBucket(15)).toBe("15 to 60 minutes");
    expect(leftBucket(59)).toBe("15 to 60 minutes");
    expect(leftBucket(90)).toBe("1 to 4 hours");
    expect(leftBucket(600)).toBe("over 4 hours");
  });
});

describe("caughtByClose", () => {
  const closures = closuresIn(week());
  const timing = sessionLeftAt(MON + 21 * H + 40 * 60, closures)!;

  it("is true when the position was still open when the market shut", () => {
    expect(caughtByClose(MON + 22 * H + 30 * 60, timing)).toBe(true);
  });

  it("is false when it was closed in time", () => {
    expect(caughtByClose(MON + 21 * H + 50 * 60, timing)).toBe(false);
  });
});
