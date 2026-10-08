import { describe, expect, it } from "vitest";
import { drawingBands, drawingCount, drawingTexts, isDocV2 } from "@/lib/core/drawings-doc";
import { legacyToKit, toDoc, toKit } from "@/lib/chart/drawings-convert";
import type { Drawing } from "@/lib/core/types";

const T = 1_736_000_040;
const SPAN = { from: T - 3600, to: T + 3600 };

const legacy: Drawing[] = [
  { id: "l", kind: "level", low: 2600, high: 2600, label: "Resistance", color: "red" },
  { id: "z", kind: "zone", low: 2590, high: 2595, label: "Demand zone", color: "green" },
  { id: "b", kind: "box", t1: T, p1: 2610, t2: T + 600, p2: 2605, label: "Order block", extend: true },
  { id: "t", kind: "trend", t1: T, p1: 2580, t2: T + 900, p2: 2620, label: "", extend: true },
  { id: "n", kind: "note", t1: T, p1: 2601, label: "Swept the Asian low" },
];

describe("old drawings into the kit", () => {
  const kit = legacyToKit(legacy, SPAN);

  it("finds an equivalent for every old tool, keeping ids, names and colours", () => {
    expect(kit.map((d) => [d.id, d.kind])).toEqual([
      ["l", "horizontal-line"], ["z", "rectangle"], ["b", "rectangle"], ["t", "ray"], ["n", "callout"],
    ]);
    expect(kit[0].style?.text).toBe("Resistance");
    expect(kit[0].style?.color).toBe("#f23645");
    expect((kit[4] as { text?: string }).text).toBe("Swept the Asian low");
  });

  it("turns a full-width zone into a rectangle extended both ways", () => {
    const z = kit[1];
    expect(z.style?.extendLeft).toBe(true);
    expect(z.style?.extendRight).toBe(true);
    expect(z.points.map((p) => p?.price).sort()).toEqual([2590, 2595]);
  });

  it("survives the kit's own validator, so the chart will load it", () => {
    const doc = toDoc({ v: 2, drawings: kit });
    expect(doc.drawings).toHaveLength(5);
    expect(toKit(doc, SPAN)).toHaveLength(5);
  });
});

describe("reading either shape", () => {
  const v2 = toDoc({ v: 2, drawings: legacyToKit(legacy, SPAN) });

  it("counts and searches both", () => {
    expect(drawingCount(legacy)).toBe(5);
    expect(drawingCount(v2)).toBe(5);
    expect(drawingCount(null)).toBe(0);
    expect(drawingTexts(legacy)).toContain("Order block");
    expect(drawingTexts(v2)).toEqual(expect.arrayContaining(["Resistance", "Demand zone", "Order block", "Swept the Asian low"]));
  });

  it("pools the same bands from both, and ignores sloped lines and notes", () => {
    const sort = (b: { low: number; high: number }[]) => b.map((x) => [x.low, x.high]).sort((a, c) => a[0] - c[0]);
    expect(sort(drawingBands(v2))).toEqual(sort(drawingBands(legacy)));
    expect(sort(drawingBands(v2))).toEqual([[2590, 2595], [2600, 2600], [2605, 2610]]);
  });
});

describe("what the server stores", () => {
  it("drops junk, kinds this app cannot store, and anything past the cap", () => {
    const doc = toDoc({
      v: 2,
      drawings: [
        { id: "ok", kind: "horizontal-line", points: [{ time: T, price: 2600 }] },
        { id: "img", kind: "image", points: [{ time: T, price: 2600 }, { time: T + 60, price: 2601 }] },
        { id: "bad", kind: "not-a-tool", points: [] },
        "junk",
      ],
    });
    expect(isDocV2(doc)).toBe(true);
    expect(doc.drawings.map((d) => d.id)).toEqual(["ok"]);

    const many = Array.from({ length: 400 }, (_, i) => ({ id: `h${i}`, kind: "horizontal-line", points: [{ time: T, price: 2600 + i }] }));
    expect(toDoc({ v: 2, drawings: many }).drawings).toHaveLength(300);
    expect(toDoc("nonsense").drawings).toEqual([]);
  });
});
