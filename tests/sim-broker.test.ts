import { describe, expect, it } from "vitest";
import { Broker, GOLD_DEFAULTS, type SimEvent, type SimSettings } from "@/lib/core/sim/broker";

const T0 = Date.UTC(2025, 2, 3, 9); // Monday 09:00 UTC
const s = (over: Partial<SimSettings> = {}): SimSettings => ({ ...GOLD_DEFAULTS, ...over });

/** A broker that has seen one tick at bid/ask. */
function at(bid: number, ask: number, over: Partial<SimSettings> = {}) {
  const b = new Broker(s(over), undefined, T0);
  b.tick(T0, bid, ask);
  return b;
}
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error((r as unknown as { error: string }).error); return r as Extract<T, { ok: true }>; };
const closes = (ev: SimEvent[]) => ev.filter((e) => e.kind === "close") as Extract<SimEvent, { kind: "close" }>[];
const ideas = (ev: SimEvent[]) => ev.filter((e) => e.kind === "idea").map((e) => (e as Extract<SimEvent, { kind: "idea" }>).idea);

describe("market orders and the sides of the spread", () => {
  it("buys at the ask and sells back at the bid", () => {
    const b = at(2000.00, 2000.20);
    const r = ok(b.act({ kind: "market", side: "buy", lots: 1 }));
    expect(b.state.positions[0].openPrice).toBe(2000.20);
    b.tick(T0 + 1000, 2001.00, 2001.20);
    const ev = ok(b.act({ kind: "close", id: r.ids[0] })).events;
    expect(closes(ev)[0].price).toBe(2001.00);
    expect(closes(ev)[0].profit).toBe(80); // (2001.00 − 2000.20) × 100
    expect(b.state.balance).toBe(10_080);
  });

  it("checks a long stop against the bid and fills it at the market on a gap", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "market", side: "buy", lots: 0.5, sl: 1999.00 }));
    expect(closes(b.tick(T0 + 1000, 1999.10, 1999.30))).toHaveLength(0); // ask below SL is not enough
    const c = closes(b.tick(T0 + 2000, 1998.60, 1998.80))[0];
    expect(c.reason).toBe("sl");
    expect(c.price).toBe(1998.60); // gapped past the stop: worse than 1999.00
  });

  it("checks a short stop against the ask", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "market", side: "sell", lots: 1, sl: 2001.00, tp: 1998.00 }));
    expect(closes(b.tick(T0 + 1000, 2000.95, 2001.05))[0]).toMatchObject({ reason: "sl", price: 2001.05 });
  });

  it("fills a take-profit at its price or better", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "market", side: "buy", lots: 1, tp: 2002.00 }));
    expect(closes(b.tick(T0 + 1000, 2002.40, 2002.60))[0]).toMatchObject({ reason: "tp", price: 2002.40 });
  });

  it("refuses stops on the wrong side and sizes off the lot step", () => {
    const b = at(2000.00, 2000.20);
    expect(b.act({ kind: "market", side: "buy", lots: 1, sl: 2000.10 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "market", side: "sell", lots: 1, tp: 2000.30 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "market", side: "buy", lots: 0.015 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "market", side: "buy", lots: 0.001 })).toMatchObject({ ok: false });
  });

  it("will not trade before it has seen a price", () => {
    const b = new Broker(s(), undefined, T0);
    expect(b.act({ kind: "market", side: "buy", lots: 1 })).toMatchObject({ ok: false });
  });
});

describe("pending orders", () => {
  it("triggers a buy limit on the ask and fills at the better price", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "pending", side: "buy", type: "limit", price: 1999.00, lots: 1, sl: 1998.00, tp: 2003.00 }));
    expect(b.tick(T0 + 1000, 1998.95, 1999.10).filter((e) => e.kind === "fill")).toHaveLength(0);
    const fill = b.tick(T0 + 2000, 1998.70, 1998.90).find((e) => e.kind === "fill");
    expect(fill).toMatchObject({ price: 1998.90, from: "limit" });
    expect(b.state.positions[0]).toMatchObject({ sl: 1998.00, tp: 2003.00 });
  });

  it("triggers a sell stop on the bid and adds slippage", () => {
    const b = at(2000.00, 2000.20, { slippage: 0.05 });
    ok(b.act({ kind: "pending", side: "sell", type: "stop", price: 1999.50, lots: 1 }));
    const fill = b.tick(T0 + 1000, 1999.40, 1999.60).find((e) => e.kind === "fill");
    expect(fill).toMatchObject({ price: 1999.35, from: "stop" });
  });

  it("refuses orders on the wrong side of the market", () => {
    const b = at(2000.00, 2000.20);
    expect(b.act({ kind: "pending", side: "buy", type: "limit", price: 2001, lots: 1 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "pending", side: "buy", type: "stop", price: 1999, lots: 1 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "pending", side: "sell", type: "limit", price: 1999, lots: 1 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "pending", side: "sell", type: "stop", price: 2001, lots: 1 })).toMatchObject({ ok: false });
  });

  it("moves and cancels an order", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "pending", side: "buy", type: "limit", price: 1999.00, lots: 1 })).ids[0];
    ok(b.act({ kind: "modify", id, price: 1998.50 }));
    expect(b.state.orders[0].price).toBe(1998.50);
    ok(b.act({ kind: "cancel", id }));
    expect(b.state.orders).toHaveLength(0);
    expect(Object.keys(b.state.ideas)).toHaveLength(0); // nothing filled: no trade recorded
  });
});

describe("managing a position", () => {
  it("closes part, then the rest, as one trade with two exits", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1, sl: 1998.20 })).ids[0];
    b.tick(T0 + 60_000, 2002.00, 2002.20);
    ok(b.act({ kind: "close", id, lots: 0.4 }));
    expect(b.state.positions[0].lots).toBe(0.6);
    b.tick(T0 + 120_000, 2003.00, 2003.20);
    const trade = ideas(ok(b.act({ kind: "close", id })).events)[0];
    expect(trade.legs.map((l) => l.lots)).toEqual([0.4, 0.6]);
    expect(trade.pnl).toBe(72 + 168); // 0.4 × 180 + 0.6 × 280
    expect(trade.risk).toBe(200); // (2000.20 − 1998.20) × 1 lot × 100
    expect(trade.r).toBe(1.2);
  });

  it("refuses a partial close that would leave less than the minimum", () => {
    const b = at(2000.00, 2000.20, { minLot: 0.1 });
    const id = ok(b.act({ kind: "market", side: "buy", lots: 0.2 })).ids[0];
    expect(b.act({ kind: "close", id, lots: 0.15 })).toMatchObject({ ok: false });
    expect(b.act({ kind: "close", id, lots: 0.05 })).toMatchObject({ ok: false });
  });

  it("moves the stop to breakeven, with a buffer, only once price allows it", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1, sl: 1998 })).ids[0];
    expect(b.act({ kind: "breakeven", id })).toMatchObject({ ok: false }); // bid is below the entry
    b.tick(T0 + 1000, 2001.00, 2001.20);
    ok(b.act({ kind: "breakeven", id, buffer: 0.10 }));
    expect(b.state.positions[0].sl).toBe(2000.30);
    expect(closes(b.tick(T0 + 2000, 2000.30, 2000.50))[0]).toMatchObject({ reason: "sl", price: 2000.30 });
  });

  it("trails a stop once in profit, and never loosens it", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1, sl: 1998 })).ids[0];
    ok(b.act({ kind: "trail", id, distance: 1 }));
    b.tick(T0 + 1000, 2000.80, 2001.00);
    expect(b.state.positions[0].sl).toBe(1998); // not yet past the entry
    b.tick(T0 + 2000, 2002.00, 2002.20);
    expect(b.state.positions[0].sl).toBe(2001.00);
    b.tick(T0 + 3000, 2001.50, 2001.70);
    expect(b.state.positions[0].sl).toBe(2001.00); // price fell back: the stop stays
    expect(closes(b.tick(T0 + 4000, 2000.90, 2001.10))[0]).toMatchObject({ reason: "sl", price: 2000.90 });
  });

  it("holds longs and shorts at the same time (hedging)", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "market", side: "buy", lots: 1 }));
    ok(b.act({ kind: "market", side: "sell", lots: 1 }));
    expect(b.state.positions.map((p) => p.side)).toEqual(["buy", "sell"]);
    const ev = ok(b.act({ kind: "closeAll" })).events;
    expect(ideas(ev)).toHaveLength(2);
  });
});

describe("ladders", () => {
  it("splits total lots evenly, the remainder on the first orders", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "ladder", side: "buy", from: 1999, to: 1997, count: 3, sl: 1995, size: { lots: 1 } }));
    expect(b.state.orders.map((o) => [o.price, o.lots])).toEqual([[1999, 0.34], [1998, 0.33], [1997, 0.33]]);
    expect(new Set(b.state.orders.map((o) => o.ideaId)).size).toBe(1);
  });

  it("splits a total risk so every order risks the same", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "ladder", side: "buy", from: 1999, to: 1997, count: 3, sl: 1995, size: { risk: 300 } }));
    // $100 each: 1999→1995 is $400 a lot, 1998 → $300, 1997 → $200.
    expect(b.state.orders.map((o) => o.lots)).toEqual([0.25, 0.33, 0.5]);
  });

  it("cancels the unfilled rest when the filled part hits its target, and measures R on what filled", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "ladder", side: "buy", from: 1999, to: 1997, count: 3, sl: 1995, tp: 2001, size: { lots: 0.3 } }));
    b.tick(T0 + 1000, 1998.70, 1998.90); // fills 1999
    b.tick(T0 + 2000, 1997.80, 1998.00); // fills 1998
    const ev = b.tick(T0 + 3000, 2001.10, 2001.30);
    expect(ev.filter((e) => e.kind === "cancel")).toHaveLength(1);
    const trade = ideas(ev)[0];
    expect(trade.legs).toHaveLength(2);
    expect(trade.risk).toBe(round2((1998.90 - 1995) * 0.1 * 100 + (1998.00 - 1995) * 0.1 * 100));
    expect(b.state.orders).toHaveLength(0);
  });
});

describe("costs, margin and the clock", () => {
  it("charges commission on both sides", () => {
    const b = at(2000.00, 2000.20, { commissionPerLot: 3.5 });
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1 })).ids[0];
    b.tick(T0 + 1000, 2000.20, 2000.40);
    const trade = ideas(ok(b.act({ kind: "close", id })).events)[0];
    expect(trade.legs[0].commission).toBe(-7);
    expect(trade.pnl).toBe(-7);
    expect(b.state.balance).toBe(9_993);
  });

  it("builds the ask from the bid when the spread is fixed or reduced", () => {
    const fixed = at(2000.00, 2000.30, { spread: { mode: "fixed", value: 0.12 } });
    expect(fixed.state.ask).toBe(2000.12);
    const minus = at(2000.00, 2000.30, { spread: { mode: "minus", value: 0.1 } });
    expect(minus.state.ask).toBe(2000.2);
    const floor = at(2000.00, 2000.05, { spread: { mode: "minus", value: 0.1 } });
    expect(floor.state.ask).toBe(2000.00);
  });

  it("stops out the biggest loser when the equity runs out", () => {
    const b = at(2000.00, 2000.20, { balance: 500, leverage: 2000 });
    ok(b.act({ kind: "market", side: "buy", lots: 1 }));
    const ev = b.tick(T0 + 1000, 1994.90, 1995.10); // −$530 floating
    expect(closes(ev)[0].reason).toBe("so");
    expect(b.state.positions).toHaveLength(0);
  });

  it("charges swap at each weekday rollover, three nights on a Wednesday", () => {
    const b = at(2000.00, 2000.20, { swapLong: -10 });
    ok(b.act({ kind: "market", side: "buy", lots: 1 }));
    b.tick(Date.UTC(2025, 2, 6, 23), 2000, 2000.2); // through Mon, Tue, Wed (×3) and Thu 22:00
    expect(b.state.positions[0].swap).toBe(-60);
  });
});

describe("R from the first stop set", () => {
  it("counts a stop dragged in after an instant entry", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1 })).ids[0];
    b.tick(T0 + 1000, 2000.50, 2000.70);
    ok(b.act({ kind: "modify", id, sl: 1999.20 }));
    expect(b.positionRisk(b.state.positions[0])).toBeCloseTo(100); // (2000.20 − 1999.20) × 1 lot × 100
    b.tick(T0 + 2000, 2002.20, 2002.40);
    const trade = ideas(ok(b.act({ kind: "close", id })).events)[0];
    expect(trade.risk).toBe(100);
    expect(trade.r).toBe(2);
  });

  it("keeps the first stop's risk when the stop is later widened or tightened", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1 })).ids[0];
    ok(b.act({ kind: "modify", id, sl: 1999.20 }));
    ok(b.act({ kind: "modify", id, sl: 1998.20 }));
    ok(b.act({ kind: "modify", id, sl: null }));
    b.tick(T0 + 1000, 2001.20, 2001.40);
    expect(ideas(ok(b.act({ kind: "close", id })).events)[0].risk).toBe(100);
  });

  it("does not count a stop set after part of the trade was closed", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1 })).ids[0];
    b.tick(T0 + 1000, 2001.00, 2001.20);
    ok(b.act({ kind: "close", id, lots: 0.5 }));
    ok(b.act({ kind: "modify", id, sl: 1999.00 }));
    expect(b.positionRisk(b.state.positions[0])).toBeNull();
    const trade = ideas(ok(b.act({ kind: "close", id })).events)[0];
    expect(trade.risk).toBeNull();
    expect(trade.r).toBeNull();
  });

  it("does not count a stop placed where price has already been", () => {
    const b = at(2000.00, 2000.20);
    const id = ok(b.act({ kind: "market", side: "buy", lots: 1 })).ids[0];
    b.tick(T0 + 1000, 1998.00, 1998.20); // sat through $2 of heat
    b.tick(T0 + 2000, 2000.50, 2000.70);
    ok(b.act({ kind: "modify", id, sl: 1999.00 })); // a $1.20 "risk" now would flatter R
    expect(ideas(ok(b.act({ kind: "close", id })).events)[0].risk).toBeNull();
  });

  it("does not count breakeven or a trailing stop as the first stop", () => {
    const b = at(2000.00, 2000.20);
    const a = ok(b.act({ kind: "market", side: "buy", lots: 0.5 })).ids[0];
    const c = ok(b.act({ kind: "market", side: "buy", lots: 0.5 })).ids[0];
    b.tick(T0 + 1000, 2002.00, 2002.20);
    ok(b.act({ kind: "breakeven", id: a }));
    ok(b.act({ kind: "trail", id: c, distance: 1 }));
    expect(b.state.positions.map((p) => b.positionRisk(p))).toEqual([null, null]);
  });

  it("adds up a ladder, counting a leg whose stop came with the order even if it fills after a partial close", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "ladder", side: "buy", from: 1999, to: 1998, count: 2, sl: 1996, size: { lots: 0.2 }, cancelRestOnClose: false }));
    b.tick(T0 + 1000, 1998.80, 1999.00); // fills 1999.00
    const first = b.state.positions[0].id;
    b.tick(T0 + 2000, 1999.80, 2000.00);
    ok(b.act({ kind: "close", id: first, lots: 0.05 })); // banks a little
    b.tick(T0 + 3000, 1997.80, 1998.00); // fills 1998.00
    const ev = ok(b.act({ kind: "closeAll" })).events;
    // (1999 − 1996) × 0.1 × 100 + (1998 − 1996) × 0.1 × 100
    expect(ideas(ev)[0].risk).toBe(50);
  });

  it("finishes a trade saved before the rule the old way", () => {
    const b = at(2000.00, 2000.20);
    ok(b.act({ kind: "market", side: "buy", lots: 1, sl: 1999.20 }));
    const old = b.snapshot();
    delete old.v;
    for (const idea of Object.values(old.ideas)) { delete idea.v; delete idea.stops; delete idea.banked; }
    for (const p of old.positions) delete p.worst;
    const resumed = new Broker(s(), old);
    resumed.tick(T0 + 1000, 2001.20, 2001.40);
    const trade = ideas(ok(resumed.act({ kind: "closeAll" })).events)[0];
    expect(trade.risk).toBe(100);
    expect(trade.r).toBe(1);
  });
});

describe("determinism", () => {
  it("resumes from a snapshot to exactly where running straight through ends", () => {
    const ticks = Array.from({ length: 400 }, (_, i) => {
      const bid = 2000 + Math.sin(i / 9) * 4 + i * 0.01;
      return [T0 + i * 15_000, Math.round(bid * 1000) / 1000, Math.round((bid + 0.18) * 1000) / 1000] as const;
    });
    const script = (b: Broker, i: number) => {
      if (i === 5) b.act({ kind: "ladder", side: "buy", from: 1998, to: 1996, count: 3, sl: 1993, tp: 2003, size: { risk: 150 } });
      if (i === 40) b.act({ kind: "market", side: "sell", lots: 0.2, sl: 2008, tp: 1997 });
      if (i === 90 && b.state.positions[0]) b.act({ kind: "trail", id: b.state.positions[0].id, distance: 1.5 });
      // An instant entry whose stop is dragged in later, then part of it banked.
      if (i === 150) b.act({ kind: "market", side: "buy", lots: 0.3 });
      const late = b.state.positions.find((p) => p.lots === 0.3 && p.sl === null && p.side === "buy");
      if (i === 160 && late) b.act({ kind: "modify", id: late.id, sl: Math.round((b.state.bid - 3) * 100) / 100 });
      const half = b.state.positions.find((p) => p.lots === 0.3 && p.side === "buy");
      if (i === 230 && half) b.act({ kind: "close", id: half.id, lots: 0.1 });
    };
    const run = (from: Broker, start: number, log: SimEvent[]) => {
      for (let i = start; i < ticks.length; i++) { script(from, i); log.push(...from.tick(...ticks[i])); }
      return from;
    };

    const straight: SimEvent[] = [];
    const a = run(new Broker(s(), undefined, T0), 0, straight);

    const first: SimEvent[] = [];
    const half = new Broker(s(), undefined, T0);
    for (let i = 0; i < 200; i++) { script(half, i); first.push(...half.tick(...ticks[i])); }
    const resumed = run(new Broker(s(), half.snapshot()), 200, first);

    expect(resumed.state).toEqual(a.state);
    expect(first).toEqual(straight);
    expect(straight.some((e) => e.kind === "idea")).toBe(true);
  });
});

function round2(n: number) { return Math.round(n * 100) / 100; }
