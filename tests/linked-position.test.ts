import { describe, expect, it } from "vitest";
import type { Drawing } from "lightweight-charts-drawing";
import { desiredDrawing, frozenDrawing, intentFromChange, levelsOf, riskMoneyOf, type LinkedTrade } from "@/lib/chart/linked-position";

const long = (entry: number, stop: number, profit: number): Drawing => ({
  id: "d1", kind: "long-position",
  points: [{ time: 1000, price: entry }, { time: 4000, price: entry }],
  style: { stopLevel: stop, profitLevel: profit },
} as unknown as Drawing);

const order = (over: Partial<LinkedTrade> = {}): LinkedTrade => ({ id: "O1", side: "buy", kind: "order", entry: 2000, sl: 1998, tp: 2004, ...over });

describe("the drawing follows the trade", () => {
  it("leaves a drawing that already matches alone (no write, so no loop)", () => {
    expect(desiredDrawing(long(2000, 2, 4), order())).toBeNull();
  });

  it("moves the stop edge when the stop-loss was moved elsewhere", () => {
    const d = desiredDrawing(long(2000, 2, 4), order({ sl: 1999 }))!;
    expect(levelsOf(d)).toMatchObject({ entry: 2000, sl: 1999, tp: 2004 });
  });

  it("snaps to the fill price, keeping the stop and target where they are", () => {
    const d = desiredDrawing(long(2000, 2, 4), order({ kind: "position", entry: 1999.8 }))!;
    expect(levelsOf(d)).toMatchObject({ entry: 1999.8, sl: 1998, tp: 2004 });
    expect(d.points[1]!.price).toBeCloseTo(1999.8);
  });

  it("keeps a faint edge where a removed target was, to drag it back", () => {
    const d = desiredDrawing(long(2000, 2, 4), order({ tp: null }))!;
    expect(d.style.profitLevel).toBe(4);
    expect(d.style.targetTransparency).toBe(95);
  });
});

describe("a change to the drawing becomes an order change", () => {
  it("moves the stop-loss when the stop edge is dragged", () => {
    expect(intentFromChange(long(2000, 2, 4), long(2000, 3, 4), order())).toEqual({ actions: [{ kind: "modify", id: "O1", sl: 1997 }] });
  });

  it("moves a pending order's whole setup when the entry is dragged", () => {
    const r = intentFromChange(long(2000, 2, 4), long(1999, 2, 4), order()) as { actions: { price: number; sl: number; tp: number }[] };
    expect(r.actions[0]).toMatchObject({ kind: "modify", id: "O1" });
    expect(r.actions[0].price).toBeCloseTo(1999);
    expect(r.actions[0].sl).toBeCloseTo(1997);
    expect(r.actions[0].tp).toBeCloseTo(2003);
  });

  it("puts a filled trade's entry back instead of moving it", () => {
    expect(intentFromChange(long(2000, 2, 4), long(1999, 2, 4), order({ kind: "position" }))).toMatchObject({ revert: expect.any(String) });
  });

  it("asks nothing when only its length or look changed", () => {
    const longer = long(2000, 2, 4);
    (longer.points[1] as { time: number }).time = 9000;
    expect(intentFromChange(long(2000, 2, 4), longer, order())).toBeNull();
  });
});

describe("sizing and records", () => {
  it("reads the risk the way the drawing's Qty does", () => {
    expect(riskMoneyOf({ accountSize: 10_000, riskPercent: 1 } as Drawing["style"], 9_000)).toBe(100);
    expect(riskMoneyOf({ riskPercent: 2 } as Drawing["style"], 9_000)).toBe(180);
    expect(riskMoneyOf({ accountSize: 50, riskDisplayMode: "money", riskAmount: 75 } as Drawing["style"], 9_000)).toBe(50);
  });

  it("freezes a closed trade's drawing to its exit, locked", () => {
    const f = frozenDrawing(long(2000, 2, 4), 7000);
    expect(f.locked).toBe(true);
    expect(f.points[1]!.time).toBe(7000);
  });
});
