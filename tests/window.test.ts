import { describe, expect, it } from "vitest";
import { contextWindow, fetchWindow } from "../lib/core/window";
import { RATE } from "../lib/core/provider-twelvedata";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 18, h, m));
const hours = (w: { from: Date; to: Date }) => (w.to.getTime() - w.from.getTime()) / 3600_000;

describe("contextWindow", () => {
  it("gives a five-minute scalp hours of context either side", () => {
    // Six minutes of bars around a six-minute trade shows nothing about where
    // price came from, which is the whole question when the setup was a level.
    expect(hours(contextWindow(at(12), at(12, 5)))).toBeCloseTo(6.08, 1);
  });

  it("scales with the trade instead of using one fixed span", () => {
    const short = hours(contextWindow(at(12), at(12, 5)));
    const long = hours(contextWindow(at(0), at(8)));
    expect(long).toBeGreaterThan(short);
  });

  it("stops growing, so one trade can never ask for a year of bars", () => {
    const huge = contextWindow(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 5, 1)));
    // 36 hours of padding either side of the trade itself.
    const padH = (huge.to.getTime() - Date.UTC(2026, 5, 1)) / 3600_000;
    expect(padH).toBe(36);
  });
});

describe("fetchWindow", () => {
  it("rounds out to whole days, so one call covers everything traded that day", () => {
    // At a hundred orders a day, asking per trade would be a hundred calls
    // against an eight-a-minute allowance.
    const w = fetchWindow(at(12), at(12, 5));
    expect(w.from.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-18T23:59:00.000Z");
  });

  it("picks up the previous day when the context reaches back over midnight", () => {
    // 00:30 with three hours of context starts at 21:30 the evening before.
    const w = fetchWindow(at(0, 30), at(0, 50));
    expect(w.from.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-18T23:59:00.000Z");
  });

  it("picks up the next day when it reaches forward over midnight", () => {
    const w = fetchWindow(at(23, 30), at(23, 50));
    expect(w.from.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-19T23:59:00.000Z");
  });

  it("never asks for more bars than one response can hold", () => {
    const w = fetchWindow(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 5, 1)));
    const minutes = (w.to.getTime() - w.from.getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(RATE.maxBars);
  });
});
