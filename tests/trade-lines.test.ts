import { describe, expect, it } from "vitest";
import { hitPills, layoutPills, type TradeLine } from "@/lib/chart/trade-lines";
import { entryDragRole } from "@/lib/chart/line-interaction";

const measure = (t: string) => t.length * 6;
const line = (over: Partial<TradeLine>): TradeLine => ({
  id: "P1:entry", obj: "P1", role: "entry", side: "buy", price: 2000, label: "BUY 0.10", color: "#2962ff", draggable: false, ...over,
});
const opts = { width: 800, height: 400, coarse: false, measure };

describe("labels on the trade lines", () => {
  it("sits at the right edge, label then buttons", () => {
    const l = line({ tabs: [{ key: "sl", text: "SL", title: "" }, { key: "close", text: "×", title: "" }] });
    const [p] = layoutPills([l], [200], opts);
    expect(p.x + p.w).toBe(792);
    expect(p.tabs.map((t) => t.key)).toEqual(["sl", "close"]);
    expect(p.tabs[1].x + p.tabs[1].w).toBeCloseTo(792);
    expect(p.y + p.h / 2).toBe(200);
  });

  it("pushes apart labels whose levels are a pixel or two apart", () => {
    const entry = line({});
    const sl = line({ id: "P1:sl", role: "sl", label: "SL", draggable: true });
    const pills = layoutPills([entry, sl], [200, 201], opts);
    const [a, b] = pills;
    expect(b.y - (a.y + a.h)).toBeGreaterThanOrEqual(2);
  });

  it("keeps the stack inside the pane at the bottom edge", () => {
    const ls = [0, 1, 2].map((i) => line({ id: `P${i}:entry`, obj: `P${i}` }));
    const pills = layoutPills(ls, [398, 399, 400], opts);
    expect(Math.max(...pills.map((p) => p.y + p.h))).toBeLessThanOrEqual(400);
  });

  it("gives touch bigger labels and buttons", () => {
    const l = line({ tabs: [{ key: "sl", text: "SL", title: "" }] });
    const [mouse] = layoutPills([l], [200], opts);
    const [touch] = layoutPills([l], [200], { ...opts, coarse: true });
    expect(touch.h).toBeGreaterThan(mouse.h);
    expect(touch.tabs[0].w).toBeGreaterThan(mouse.tabs[0].w);
  });

  it("skips lines off the chart and bare lines", () => {
    expect(layoutPills([line({}), line({ id: "ask", role: "ask", bare: true })], [null, 100], opts)).toHaveLength(0);
  });
});

describe("what a press lands on", () => {
  const entry = line({ tabs: [{ key: "sl", text: "SL", title: "" }, { key: "close", text: "×", title: "" }] });
  const sl = line({ id: "P1:sl", role: "sl", price: 1998, label: "SL", draggable: true });
  const ys = [100, 300];
  const pills = layoutPills([entry, sl], ys, opts);

  it("finds a label's button before the label, and the label before the line", () => {
    const p = pills.find((x) => x.line.id === "P1:entry")!;
    const close = p.tabs.find((t) => t.key === "close")!;
    expect(hitPills(pills, [entry, sl], ys, close.x + 2, 100, false)).toMatchObject({ part: { tab: "close" } });
    expect(hitPills(pills, [entry, sl], ys, p.labelX + 2, 100, false)).toMatchObject({ part: "label", line: { id: "P1:entry" } });
  });

  it("grabs a stop's line anywhere along it, but never an entry's bare line", () => {
    expect(hitPills(pills, [entry, sl], ys, 50, 303, false)).toMatchObject({ part: "line", line: { id: "P1:sl" } });
    expect(hitPills(pills, [entry, sl], ys, 50, 100, false)).toBeNull();
  });

  it("is more forgiving with a finger", () => {
    expect(hitPills(pills, [entry, sl], ys, 50, 312, false)).toBeNull();
    expect(hitPills(pills, [entry, sl], ys, 50, 312, true)).toMatchObject({ line: { id: "P1:sl" } });
  });
});

describe("dragging out from the entry", () => {
  const m = { bid: 2000, ask: 2000.2 };
  it("makes a stop toward loss and a target toward profit, judged by the current price", () => {
    expect(entryDragRole("buy", 1999, m)).toBe("sl");
    expect(entryDragRole("buy", 2001, m)).toBe("tp");
    expect(entryDragRole("sell", 2001, m)).toBe("sl");
    expect(entryDragRole("sell", 1999, m)).toBe("tp");
  });
  it("lets a buy's stop go above the entry to lock in profit while price is higher still", () => {
    // Bought at 1995, price now 2000: a stop at 1997 is above the entry but below the bid.
    expect(entryDragRole("buy", 1997, m)).toBe("sl");
  });
});
