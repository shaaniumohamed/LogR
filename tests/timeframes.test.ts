import { describe, expect, it } from "vitest";
import { HIGHER_TIMEFRAMES, checkBarAlignment, higherTimeframe } from "../lib/core/timeframes";
import { buildUrl } from "../lib/core/provider-twelvedata";

const DAY = 86_400;

/** Daily gold bars, each a five-dollar range around a rising close. */
function dailyBars(n: number, start = 3300) {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + i;
    return { time: i * DAY, open: mid, high: mid + 2.5, low: mid - 2.5, close: mid };
  });
}

describe("checkBarAlignment", () => {
  const bars = dailyBars(30);

  it("passes fills that sit inside their own day", () => {
    const fills = [0, 5, 10, 20].map((d) => ({ time: d * DAY + 3600, price: 3300 + d }));
    const r = checkBarAlignment(bars, fills, DAY);
    expect(r.checked).toBe(4);
    expect(r.score).toBe(1);
  });

  it("catches a different instrument outright", () => {
    // A currency pair's prices cannot land inside gold's daily ranges.
    const fills = [0, 5, 10, 20].map((d) => ({ time: d * DAY + 3600, price: 1.08 }));
    const r = checkBarAlignment(bars, fills, DAY);
    expect(r.checked).toBe(4);
    expect(r.score).toBe(0);
    expect(r.lenientScore).toBe(0);
  });

  it("forgives a fill that landed in the neighbouring day", () => {
    // Providers disagree about which calendar day a late-evening bar belongs to,
    // and being out by one daily bar is not evidence of anything.
    // Day 10 tops out at 3312.50; day 11 reaches 3313.50.
    const fills = [{ time: 10 * DAY + 3600, price: 3313 }];
    const r = checkBarAlignment(bars, fills, DAY);
    expect(r.score).toBe(0);
    expect(r.lenientScore).toBe(1);
  });

  it("ignores fills from outside the range the bars cover", () => {
    const fills = [{ time: -50 * DAY, price: 3000 }, { time: 500 * DAY, price: 4000 }];
    expect(checkBarAlignment(bars, fills, DAY).checked).toBe(0);
  });

  it("says nothing rather than something wrong when there is no data", () => {
    expect(checkBarAlignment([], [{ time: 0, price: 1 }], DAY).score).toBeNull();
    expect(checkBarAlignment(bars, [], DAY).score).toBeNull();
  });

  it("works the same at four hours as at a day", () => {
    const fourH = 4 * 3600;
    const bars4 = Array.from({ length: 50 }, (_, i) => ({
      time: i * fourH, open: 3300, high: 3302, low: 3298, close: 3301,
    }));
    const good = checkBarAlignment(bars4, [{ time: 10 * fourH + 60, price: 3300 }], fourH);
    expect(good.score).toBe(1);
    const bad = checkBarAlignment(bars4, [{ time: 10 * fourH + 60, price: 3500 }], fourH);
    expect(bad.score).toBe(0);
  });
});

describe("higher timeframe definitions", () => {
  it("covers the confirmations a level trader actually reads", () => {
    expect(HIGHER_TIMEFRAMES.map((t) => t.label)).toEqual(["1H", "4H", "1D", "1W"]);
  });

  it("loads more history the coarser the timeframe", () => {
    for (let i = 1; i < HIGHER_TIMEFRAMES.length; i++) {
      expect(HIGHER_TIMEFRAMES[i].loadBefore).toBeGreaterThan(HIGHER_TIMEFRAMES[i - 1].loadBefore);
      expect(HIGHER_TIMEFRAMES[i].seconds).toBeGreaterThan(HIGHER_TIMEFRAMES[i - 1].seconds);
    }
  });

  it("always shows less than it loads, so there is room to pan", () => {
    for (const t of HIGHER_TIMEFRAMES) {
      expect(t.viewBefore).toBeLessThan(t.loadBefore);
      expect(t.viewAfter).toBeLessThanOrEqual(t.loadAfter);
    }
  });

  it("rejects an interval it does not know", () => {
    expect(higherTimeframe("1day")).toBeDefined();
    expect(higherTimeframe("2day")).toBeUndefined();
  });
});

describe("buildUrl with an interval", () => {
  it("asks for the interval it was given and leaves the range open", () => {
    const u = new URL(buildUrl({ symbol: "XAUUSDm", interval: "1day" }));
    expect(u.searchParams.get("symbol")).toBe("XAU/USD");
    expect(u.searchParams.get("interval")).toBe("1day");
    expect(u.searchParams.get("timezone")).toBe("UTC");
    expect(u.searchParams.has("start_date")).toBe(false);
    expect(u.searchParams.has("end_date")).toBe(false);
  });

  it("still defaults to one minute with a range, for the per-day backfill", () => {
    const u = new URL(buildUrl({
      symbol: "XAUUSD",
      from: new Date(Date.UTC(2026, 8, 18)),
      to: new Date(Date.UTC(2026, 8, 18, 23, 59)),
    }));
    expect(u.searchParams.get("interval")).toBe("1min");
    expect(u.searchParams.get("start_date")).toBe("2026-09-18T00:00:00");
  });

  it("never puts the key in the URL", () => {
    expect(buildUrl({ symbol: "XAUUSD", interval: "1week" })).not.toMatch(/apikey|api_key/i);
  });
});
