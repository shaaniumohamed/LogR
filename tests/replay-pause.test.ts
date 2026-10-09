import { describe, expect, it } from "vitest";
import type { TickSeries } from "@/lib/core/market/format";
import { Broker, GOLD_DEFAULTS, type SimEvent } from "@/lib/core/sim/broker";
import { feedTicks } from "@/lib/core/replay/ticks";
import { DEFAULT_AUTOPAUSE, nextPausePoint, pauseForEvent } from "@/lib/core/replay/pauses";
import { SESSIONS, startTimeFor } from "@/lib/core/replay/clock";

const at = (iso: string) => Date.parse(iso) / 1000;
const DAY = at("2025-03-04T00:00:00Z");

/** A day of ticks every 2 s from 08:00 UTC, falling slowly, with a doubled tick at `dupAt` (ms from the day start). */
function ticks(n = 2000, dupAt = -1): TickSeries {
  const ms: number[] = [], bid: number[] = [], ask: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = 8 * 3_600_000 + i * 2000;
    const b = 2_000_000 - i * 3; // 0.003 down each tick
    ms.push(t); bid.push(b); ask.push(b + 200);
    if (t === dupAt) { ms.push(t); bid.push(b - 50); ask.push(b + 150); }
  }
  return { dayStart: DAY, decimals: 3, count: ms.length, ms: Int32Array.from(ms), bid: Int32Array.from(bid), ask: Int32Array.from(ask) };
}

function broker(t: TickSeries) {
  const b = new Broker({ ...GOLD_DEFAULTS }, undefined, DAY * 1000);
  b.tick(DAY * 1000 + t.ms[0], t.bid[0] / 1000, t.ask[0] / 1000);
  b.act({ kind: "market", side: "buy", lots: 1, sl: 1998.5 });
  return b;
}
const stopOn = (e: SimEvent) => pauseForEvent(e, DEFAULT_AUTOPAUSE) !== null;

describe("stopping on the tick that matters", () => {
  it("stops right after the tick that hit the stop-loss", () => {
    const t = ticks();
    const b = broker(t);
    const events: SimEvent[] = [];
    const stopped = feedTicks(b, t, DAY * 1000 + t.ms[0], DAY * 1000 + 86_400_000, events, stopOn);
    const hit = events.find((e) => e.kind === "close")!;
    expect(stopped).toBe(hit.time);
    expect(b.state.time).toBe(hit.time);
    expect(b.state.bid).toBeLessThanOrEqual(1998.5);
    expect(b.state.bid).toBeGreaterThan(1998.49); // the first tick at or below the stop, not one after
  });

  it("feeds the other ticks with the same millisecond before stopping", () => {
    // Find where the stop is hit, then double that tick.
    const plain = ticks();
    const b0 = broker(plain);
    const at0 = feedTicks(b0, plain, DAY * 1000 + plain.ms[0], DAY * 1000 + 86_400_000, [], stopOn)! - DAY * 1000;
    const t = ticks(2000, at0);
    const b = broker(t);
    const stopped = feedTicks(b, t, DAY * 1000 + t.ms[0], DAY * 1000 + 86_400_000, [], stopOn)!;
    expect(stopped - DAY * 1000).toBe(at0);
    const i = t.ms.lastIndexOf(at0);
    expect(b.state.bid).toBe(t.bid[i] / 1000); // the doubled tick was fed too
  });

  it("pausing and carrying on ends exactly where running straight through does", () => {
    const t = ticks();
    const straight = broker(t);
    const a: SimEvent[] = [];
    feedTicks(straight, t, DAY * 1000 + t.ms[0], DAY * 1000 + 86_400_000, a);

    const paused = broker(t);
    const b: SimEvent[] = [];
    const stop = feedTicks(paused, t, DAY * 1000 + t.ms[0], DAY * 1000 + 86_400_000, b, stopOn)!;
    feedTicks(paused, t, stop, DAY * 1000 + 86_400_000, b, stopOn);
    expect(paused.state).toEqual(straight.state);
    expect(b).toEqual(a);
  });

  it("never pauses for the trader's own actions", () => {
    expect(pauseForEvent({ kind: "fill", time: 0, positionId: "P1", ideaId: "T1", side: "buy", lots: 1, price: 1, from: "market" }, DEFAULT_AUTOPAUSE)).toBeNull();
    expect(pauseForEvent({ kind: "close", time: 0, positionId: "P1", ideaId: "T1", side: "buy", lots: 1, price: 1, reason: "user", profit: 0 }, DEFAULT_AUTOPAUSE)).toBeNull();
    expect(pauseForEvent({ kind: "fill", time: 0, positionId: "P1", ideaId: "T1", side: "buy", lots: 1, price: 1, from: "limit" }, DEFAULT_AUTOPAUSE)).toMatchObject({ kind: "fill" });
    expect(pauseForEvent({ kind: "close", time: 0, positionId: "P1", ideaId: "T1", side: "buy", lots: 1, price: 1, reason: "tp", profit: 5 }, { ...DEFAULT_AUTOPAUSE, stops: false })).toBeNull();
  });
});

describe("moments to stop at while playing", () => {
  const london = SESSIONS.filter((s) => s.id === "london");
  const news = [{ at: at("2025-03-07T13:30:00Z"), title: "Non-farm payrolls" }];

  it("stops two minutes before a release, and only once it is ahead", () => {
    const from = at("2025-03-07T12:00:00Z") * 1000;
    expect(nextPausePoint(from, from + 3 * 3_600_000, { news, leadSec: 120, sessions: [] }))
      .toMatchObject({ at: at("2025-03-07T13:28:00Z") * 1000, reason: { kind: "news", title: "Non-farm payrolls" } });
    // Standing on the pause point, the next one is not the same moment again.
    expect(nextPausePoint(at("2025-03-07T13:28:00Z") * 1000, from + 3 * 3_600_000, { news, leadSec: 120, sessions: [] })).toBeNull();
  });

  it("stops at the London open, which moves with British summer time", () => {
    const fri = at("2025-03-28T06:00:00Z") * 1000;
    expect(nextPausePoint(fri, fri + 86_400_000, { news: [], leadSec: 120, sessions: london })?.at).toBe(at("2025-03-28T08:00:00Z") * 1000);
    const mon = at("2025-03-31T05:00:00Z") * 1000;
    expect(nextPausePoint(mon, mon + 86_400_000, { news: [], leadSec: 120, sessions: london })?.at).toBe(at("2025-03-31T07:00:00Z") * 1000);
  });

  it("returns nothing when the next moment is beyond the frame", () => {
    const from = at("2025-03-07T09:00:00Z") * 1000;
    expect(nextPausePoint(from, from + 60_000, { news, leadSec: 120, sessions: london })).toBeNull();
  });
});

describe("where a random start lands in its day", () => {
  it("opens the day, or an hour before a session, daylight saving included", () => {
    expect(startTimeFor("2025-03-04", "day")).toBe(at("2025-03-04T00:00:00Z"));
    expect(startTimeFor("2025-03-28", "london")).toBe(at("2025-03-28T07:00:00Z"));
    expect(startTimeFor("2025-03-31", "london")).toBe(at("2025-03-31T06:00:00Z"));
    expect(startTimeFor("2025-03-04", "newyork")).toBe(at("2025-03-04T12:00:00Z")); // opens 08:00 EST = 13:00 UTC
    expect(startTimeFor("2025-03-31", "tokyo")).toBe(at("2025-03-30T23:00:00Z")); // Sunday evening, just after the weekly open
  });

  it("picks a whole minute between 00:05 and 20:30 UTC", () => {
    expect(startTimeFor("2025-03-04", "random", () => 0)).toBe(at("2025-03-04T00:05:00Z"));
    expect(startTimeFor("2025-03-04", "random", () => 0.999999)).toBe(at("2025-03-04T20:30:00Z"));
    const t = startTimeFor("2025-03-04", "random", () => 0.5);
    expect(t % 60).toBe(0);
  });
});
