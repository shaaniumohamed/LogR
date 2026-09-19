import { describe, expect, it } from "vitest";
import { clusterPositions, identityHash } from "../lib/core/cluster";
import type { Position } from "../lib/core/types";

let t = 0;
const at = (min: number) => new Date(Date.UTC(2026, 8, 18, 12, min, 0));
const pos = (o: Partial<Position> = {}): Position => ({
  ticket: String(++t),
  openedAt: at(0), closedAt: at(10),
  direction: "long", lots: 0.01, symbol: "XAUUSD",
  openPrice: 4350, closePrice: 4352,
  stopLoss: null, takeProfit: null, commission: 0, swap: 0,
  profit: 2, closeReason: "user", ...o,
});

describe("clusterPositions", () => {
  it("groups a laddered entry into one zone trade", () => {
    const legs = [
      pos({ openedAt: at(0), openPrice: 4350.0 }),
      pos({ openedAt: at(1), openPrice: 4349.2 }),
      pos({ openedAt: at(3), openPrice: 4348.6 }),
    ];
    const zt = clusterPositions(legs);
    expect(zt).toHaveLength(1);
    expect(zt[0].legCount).toBe(3);
    expect(zt[0].zoneLow).toBe(4348.6);
    expect(zt[0].zoneHigh).toBe(4350);
    expect(zt[0].netPnl).toBe(6);
  });

  it("splits when direction differs", () => {
    expect(clusterPositions([
      pos({ openedAt: at(0), direction: "long" }),
      pos({ openedAt: at(1), direction: "short" }),
    ])).toHaveLength(2);
  });

  it("splits when the next entry is outside the price band", () => {
    // A $30 move on gold is a different zone, not a deeper ladder.
    expect(clusterPositions([
      pos({ openedAt: at(0), openPrice: 4350 }),
      pos({ openedAt: at(1), openPrice: 4380 }),
    ])).toHaveLength(2);
  });

  it("splits when the position went flat before the next entry", () => {
    // Re-entering the same zone later is a NEW trade, not a continuation.
    expect(clusterPositions([
      pos({ openedAt: at(0), closedAt: at(2), openPrice: 4350 }),
      pos({ openedAt: at(5), closedAt: at(9), openPrice: 4350.4 }),
    ])).toHaveLength(2);
  });

  it("splits on a long time gap even inside the band", () => {
    expect(clusterPositions([
      pos({ openedAt: at(0), closedAt: at(200), openPrice: 4350 }),
      pos({ openedAt: at(100), closedAt: at(200), openPrice: 4350.2 }),
    ])).toHaveLength(2);
  });

  it("scales the band with price, so it means the same at any gold level", () => {
    const near = clusterPositions([
      pos({ openedAt: at(0), openPrice: 4350 }), pos({ openedAt: at(1), openPrice: 4354 }),
    ]);
    expect(near).toHaveLength(1);
    const far = clusterPositions([
      pos({ openedAt: at(0), openPrice: 1800 }), pos({ openedAt: at(1), openPrice: 1804 }),
    ]);
    // Same absolute gap, much lower price — now outside the relative band.
    expect(far).toHaveLength(2);
  });

  it("uses volume-weighted average entry", () => {
    const zt = clusterPositions([
      pos({ openedAt: at(0), openPrice: 4300, lots: 0.01 }),
      pos({ openedAt: at(1), openPrice: 4302, lots: 0.03 }),
    ]);
    expect(zt[0].avgEntry).toBe(4301.5);
    expect(zt[0].lots).toBe(0.04);
  });

  it("gives the same id for the same legs regardless of order", () => {
    const a = pos({ ticket: "aaa" }), b = pos({ ticket: "bbb" });
    expect(identityHash([a, b])).toBe(identityHash([b, a]));
    expect(identityHash([a])).not.toBe(identityHash([a, b]));
  });

  it("preserves total P&L through clustering", () => {
    const legs = Array.from({ length: 40 }, (_, i) =>
      pos({ openedAt: at(i), openPrice: 4350 + (i % 5) * 0.3, profit: i % 3 === 0 ? -1.5 : 2.25 })
    );
    const total = legs.reduce((s, l) => s + l.profit, 0);
    const clustered = clusterPositions(legs).reduce((s, z) => s + z.netPnl, 0);
    expect(Math.abs(clustered - total)).toBeLessThan(0.01);
  });
});
