import { describe, expect, it } from "vitest";
import { clusterLevels, levelTolerance, type Mark } from "../lib/core/levels";

const at = (day: number) => new Date(Date.UTC(2026, 8, day));
const mark = (tradeId: string, low: number, high: number, label: string, netPnl: number, day = 1): Mark =>
  ({ tradeId, low, high, label, netPnl, at: at(day) });

describe("levelTolerance", () => {
  it("scales with the instrument rather than assuming one", () => {
    const gold = levelTolerance([mark("a", 3300, 3305, "Demand zone", 0)]);
    const fx = levelTolerance([mark("a", 1.0800, 1.0805, "Demand zone", 0)]);
    expect(gold).toBeGreaterThan(fx);
    expect(gold).toBeCloseTo(2.5, 5);   // half the 5.00 band height
    expect(fx).toBeCloseTo(0.00054, 5); // five parts in ten thousand of 1.08
  });

  it("is zero for no marks rather than throwing", () => {
    expect(levelTolerance([])).toBe(0);
  });
});

describe("clusterLevels", () => {
  it("puts drawings at the same price together", () => {
    const levels = clusterLevels([
      mark("t1", 3320, 3325, "Demand zone", 40, 1),
      mark("t2", 3321, 3326, "Demand zone", -10, 2),
      mark("t3", 3390, 3395, "Supply zone", 25, 3),
    ], 1);
    expect(levels.length).toBe(2);
    expect(levels[0].trades).toBe(2);
    expect(levels[0].net).toBe(30);
    expect(levels[0].low).toBe(3320);
    expect(levels[0].high).toBe(3326);
  });

  it("keeps bands further apart than the tolerance separate", () => {
    const levels = clusterLevels([
      mark("t1", 3320, 3321, "Demand zone", 10),
      mark("t2", 3330, 3331, "Demand zone", 10),
    ], 1);
    expect(levels.length).toBe(2);
  });

  it("treats a flip as one level with two names, not two levels", () => {
    // The MSNR case the whole function exists for.
    const [level] = clusterLevels([
      mark("t1", 3320, 3324, "Demand zone", 30, 1),
      mark("t2", 3321, 3325, "Demand zone", 20, 2),
      mark("t3", 3320, 3325, "Supply zone", -15, 9),
    ], 1);
    expect(level.trades).toBe(3);
    expect(level.labels.map((l) => l.label)).toEqual(["Demand zone", "Supply zone"]);
    expect(level.labels[0].count).toBe(2);
  });

  it("counts a trade once however many times it marked the same band", () => {
    const [level] = clusterLevels([
      mark("t1", 3320, 3324, "Demand zone", 50),
      mark("t1", 3321, 3323, "Structure", 50),
    ], 1);
    expect(level.trades).toBe(1);
    expect(level.net).toBe(50);
    expect(level.wins).toBe(1);
  });

  it("records when a level was first and last traded", () => {
    const [level] = clusterLevels([
      mark("t1", 3320, 3324, "Demand zone", 10, 4),
      mark("t2", 3321, 3323, "Demand zone", 10, 1),
      mark("t3", 3322, 3325, "Demand zone", 10, 11),
    ], 1);
    expect(level.firstSeen).toEqual(at(1));
    expect(level.lastSeen).toEqual(at(11));
  });

  it("handles a level drawn upside down", () => {
    const [level] = clusterLevels([mark("t1", 3325, 3320, "Demand zone", 10)], 1);
    expect(level.low).toBe(3320);
    expect(level.high).toBe(3325);
  });

  it("clusters a bare level, which has no height at all", () => {
    const levels = clusterLevels([
      mark("t1", 3320, 3320, "Liquidity", 10),
      mark("t2", 3320.4, 3320.4, "Liquidity", -5),
    ], 1);
    expect(levels.length).toBe(1);
    expect(levels[0].trades).toBe(2);
  });

  it("is empty-safe", () => {
    expect(clusterLevels([])).toEqual([]);
  });

  it("puts the level you traded most at the top", () => {
    const levels = clusterLevels([
      mark("t1", 3400, 3401, "Supply zone", 500),
      mark("t2", 3320, 3321, "Demand zone", 5),
      mark("t3", 3320, 3321, "Demand zone", 5),
    ], 1);
    expect(levels[0].trades).toBe(2);
  });
});
