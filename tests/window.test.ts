import { describe, expect, it } from "vitest";
import { contextWindow, fetchWindow } from "../lib/core/window";
import { RATE } from "../lib/core/provider-twelvedata";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 18, h, m));
const hours = (w: { from: Date; to: Date }) => (w.to.getTime() - w.from.getTime()) / 3600_000;

const before = (w: { from: Date }, open: Date) => (open.getTime() - w.from.getTime()) / 3600_000;
const after = (w: { to: Date }, close: Date) => (w.to.getTime() - close.getTime()) / 3600_000;

describe("contextWindow", () => {
  it("gives a five-minute scalp a session of history behind it", () => {
    // Three hours either side still put the entry in the middle with barely a
    // session behind it, which is the half of the chart that explains the trade.
    const w = contextWindow(at(12), at(12, 5));
    expect(before(w, at(12))).toBe(12);
    expect(after(w, at(12, 5))).toBe(1);
  });

  it("weights the window to the left, where the reason for the trade is", () => {
    const w = contextWindow(at(12), at(12, 5));
    expect(before(w, at(12))).toBeGreaterThan(after(w, at(12, 5)) * 4);
  });

  it("scales with the trade instead of using one fixed span", () => {
    const short = hours(contextWindow(at(12), at(12, 5)));
    const long = hours(contextWindow(at(0), at(8)));
    expect(long).toBeGreaterThan(short);
  });

  it("stops growing, so one trade can never ask for a year of bars", () => {
    const openedAt = new Date(Date.UTC(2026, 0, 1));
    const closedAt = new Date(Date.UTC(2026, 5, 1));
    const w = contextWindow(openedAt, closedAt);
    expect(before(w, openedAt)).toBe(36);
    expect(after(w, closedAt)).toBe(12);
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

  it("still fits inside one response now the context reaches further back", () => {
    for (const w of [fetchWindow(at(12), at(12, 5)), fetchWindow(at(2), at(6))]) {
      expect((w.to.getTime() - w.from.getTime()) / 60_000).toBeLessThanOrEqual(RATE.maxBars);
    }
  });

  it("picks up the previous day when the context reaches back over midnight", () => {
    // Twelve hours of history behind a midday trade starts the day before.
    const w = fetchWindow(at(0, 30), at(0, 50));
    expect(w.from.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-18T23:59:00.000Z");
  });

  it("picks up the next day when it reaches forward over midnight", () => {
    // Opened at 23:30, so the twelve hours behind it stay inside the same day
    // and only the hour after it spills over.
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
