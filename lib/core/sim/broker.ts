import type { CloseReason, Position } from "@/lib/core/types";

/**
 * A simulated MT5 hedging account, fed one tick at a time.
 *
 * It is deterministic: the same settings, the same actions at the same moments
 * and the same ticks give the same result to the cent, and a snapshot taken at
 * any point and resumed gives what running straight through would have. That
 * is what lets a backtest be saved as "a snapshot plus what happened since",
 * and what the tests hold it to.
 *
 * The fill rules are MT5's, read at tick level so nothing is ever guessed
 * inside a candle:
 *   - a buy opens at the ask and closes at the bid; a sell the other way round;
 *   - a long position's stop and target are checked against the bid, a short
 *     position's against the ask;
 *   - limit orders and take-profits fill at their price or better (a gap gives
 *     the better price); stops and stop-losses fill at the market, which on a
 *     gap is worse — plus any slippage the session is set to add.
 */

export type Side = "buy" | "sell";

export interface SimSettings {
  symbol: string;
  /** Units per 1.00 lot (100 oz for gold). */
  contractSize: number;
  minLot: number;
  lotStep: number;
  /** Starting balance, account currency. */
  balance: number;
  leverage: number;
  /** Charged on each side, per 1.00 lot. */
  commissionPerLot: number;
  /** How the ask is made from the recorded prices. */
  spread: { mode: "recorded" } | { mode: "fixed"; value: number } | { mode: "minus"; value: number };
  /** Price added against the trader on market fills, stop orders and stop-losses. */
  slippage: number;
  /** Swap per 1.00 lot per night (negative is a charge), at the 22:00 UTC rollover; triple on Wednesday. */
  swapLong: number;
  swapShort: number;
  /** Margin level (%) at which losing positions are closed; 0 = when equity runs out. */
  stopOutLevel: number;
}

export const GOLD_DEFAULTS: SimSettings = {
  symbol: "XAUUSD", contractSize: 100, minLot: 0.01, lotStep: 0.01,
  balance: 10_000, leverage: 500, commissionPerLot: 0, spread: { mode: "recorded" },
  slippage: 0, swapLong: 0, swapShort: 0, stopOutLevel: 0,
};

export interface OpenPosition {
  id: string;
  ideaId: string;
  side: Side;
  lots: number;
  openPrice: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  /** The stop at entry, for measuring the trade in R. */
  initialSl: number | null;
  /** Commission already charged for opening (negative), per remaining lots. */
  commission: number;
  swap: number;
  trail: number | null;
}

export interface PendingOrder {
  id: string;
  ideaId: string;
  side: Side;
  type: "limit" | "stop";
  price: number;
  lots: number;
  sl: number | null;
  tp: number | null;
  trail: number | null;
  createdTime: number;
}

/** One trade idea: everything opened under it, so a ladder is one trade. */
export interface Idea {
  id: string;
  side: Side;
  /** Money at risk if every filled leg hit its initial stop; null if any filled without one. */
  risk: number | null;
  openedAt: number | null;
  /** When it ends by stop or target, cancel its unfilled orders too. */
  cancelRestOnClose: boolean;
  /** Close events so far. */
  legs: ClosedLeg[];
}

export interface ClosedLeg extends Omit<Position, "openedAt" | "closedAt"> {
  ideaId: string;
  positionId: string;
  openedAt: number;
  closedAt: number;
}

export interface SimState {
  time: number;
  bid: number;
  ask: number;
  balance: number;
  nextId: number;
  positions: OpenPosition[];
  orders: PendingOrder[];
  ideas: Record<string, Idea>;
  /** Last rollover charged (epoch ms of the 22:00 UTC boundary). */
  lastRollover: number;
}

/** What a tick or an action caused, for markers on the chart and the log. */
export type SimEvent =
  | { kind: "fill"; time: number; positionId: string; ideaId: string; side: Side; lots: number; price: number; from: "market" | "limit" | "stop" }
  | { kind: "close"; time: number; positionId: string; ideaId: string; side: Side; lots: number; price: number; reason: CloseReason; profit: number }
  | { kind: "cancel"; time: number; orderId: string; ideaId: string; why: "user" | "idea closed" }
  | { kind: "modify"; time: number; id: string }
  | { kind: "idea"; time: number; idea: ClosedIdea };

export interface ClosedIdea {
  id: string;
  side: Side;
  legs: ClosedLeg[];
  openedAt: number;
  closedAt: number;
  /** Net of commission and swap. */
  pnl: number;
  risk: number | null;
  r: number | null;
}

export type SimAction =
  | { kind: "market"; side: Side; lots: number; sl?: number | null; tp?: number | null; trail?: number | null; ideaId?: string }
  | { kind: "pending"; side: Side; type: "limit" | "stop"; price: number; lots: number; sl?: number | null; tp?: number | null; trail?: number | null; ideaId?: string }
  | {
      kind: "ladder"; side: Side; from: number; to: number; count: number; sl: number; tp?: number | null;
      /** Total lots split evenly, or total risk (account currency) split evenly. */
      size: { lots: number } | { risk: number };
      cancelRestOnClose?: boolean;
    }
  | { kind: "modify"; id: string; sl?: number | null; tp?: number | null; price?: number }
  | { kind: "cancel"; id: string }
  | { kind: "close"; id: string; lots?: number }
  | { kind: "closeAll"; side?: Side }
  | { kind: "cancelAll" }
  | { kind: "breakeven"; id: string; buffer?: number }
  | { kind: "trail"; id: string; distance: number | null };

export type ActionResult = { ok: true; events: SimEvent[]; ids: string[] } | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundPrice = (n: number) => Math.round(n * 1e5) / 1e5;
const ROLLOVER_HOUR = 22;
const DAY_MS = 86_400_000;

export function initialState(settings: SimSettings, time: number): SimState {
  return {
    time, bid: NaN, ask: NaN, balance: settings.balance, nextId: 1,
    positions: [], orders: [], ideas: {}, lastRollover: rolloverAtOrBefore(time),
  };
}

function rolloverAtOrBefore(time: number) {
  const r = Math.floor(time / DAY_MS) * DAY_MS + ROLLOVER_HOUR * 3_600_000;
  return r <= time ? r : r - DAY_MS;
}

export class Broker {
  state: SimState;

  constructor(readonly settings: SimSettings, state?: SimState, time = 0) {
    this.state = state ? structuredClone(state) : initialState(settings, time);
  }

  /** A deep copy of the state, for saving. */
  snapshot(): SimState { return structuredClone(this.state); }

  /* --------------------------------------------------------- reading */

  get hasPrices() { return Number.isFinite(this.state.bid) && Number.isFinite(this.state.ask); }

  floating(p: OpenPosition, bid = this.state.bid, ask = this.state.ask): number {
    const close = p.side === "buy" ? bid : ask;
    return (p.side === "buy" ? close - p.openPrice : p.openPrice - close) * p.lots * this.settings.contractSize;
  }

  equity(): number {
    let e = this.state.balance;
    for (const p of this.state.positions) e += this.floating(p) + p.commission + p.swap;
    return e;
  }

  margin(): number {
    let m = 0;
    for (const p of this.state.positions) m += (p.lots * this.settings.contractSize * p.openPrice) / this.settings.leverage;
    return m;
  }

  /** Lots for a given risk in account currency between an entry and a stop, rounded down to the lot step. */
  lotsForRisk(risk: number, entry: number, stop: number): number {
    const perLot = Math.abs(entry - stop) * this.settings.contractSize;
    if (!(perLot > 0) || !(risk > 0)) return 0;
    return this.roundLots(risk / perLot, "down");
  }

  roundLots(lots: number, mode: "nearest" | "down" = "nearest"): number {
    const step = this.settings.lotStep;
    const n = mode === "down" ? Math.floor(lots / step + 1e-9) : Math.round(lots / step);
    return Math.round(n * step * 100) / 100;
  }

  /* --------------------------------------------------------- actions */

  act(action: SimAction): ActionResult {
    if (!this.hasPrices) return { ok: false, error: "No price yet — play or step the replay first." };
    const events: SimEvent[] = [];
    const ids: string[] = [];
    const s = this.state;
    const { bid, ask } = s;

    switch (action.kind) {
      case "market": {
        const lots = this.validLots(action.lots);
        if (typeof lots === "string") return { ok: false, error: lots };
        const price = action.side === "buy" ? ask + this.settings.slippage : bid - this.settings.slippage;
        const bad = this.badStops(action.side, action.side === "buy" ? bid : ask, action.sl ?? null, action.tp ?? null, "position");
        if (bad) return { ok: false, error: bad };
        const idea = this.idea(action.ideaId, action.side, false);
        const id = this.open(idea, action.side, lots, price, action.sl ?? null, action.tp ?? null, action.trail ?? null, "market", events);
        ids.push(id);
        break;
      }
      case "pending": {
        const lots = this.validLots(action.lots);
        if (typeof lots === "string") return { ok: false, error: lots };
        const bad = this.badOrderPrice(action.side, action.type, action.price)
          ?? this.badStops(action.side, action.price, action.sl ?? null, action.tp ?? null, "order");
        if (bad) return { ok: false, error: bad };
        const idea = this.idea(action.ideaId, action.side, false);
        ids.push(this.place(idea, action.side, action.type, action.price, lots, action.sl ?? null, action.tp ?? null, action.trail ?? null));
        break;
      }
      case "ladder": {
        const n = Math.round(action.count);
        if (n < 1 || n > 50) return { ok: false, error: "A ladder has between 1 and 50 orders." };
        const prices = Array.from({ length: n }, (_, i) => roundPrice(n === 1 ? action.from : action.from + ((action.to - action.from) * i) / (n - 1)));
        for (const p of prices) {
          const bad = this.badOrderPrice(action.side, "limit", p) ?? this.badStops(action.side, p, action.sl, action.tp ?? null, "order");
          if (bad) return { ok: false, error: `${bad} (order at ${p})` };
        }
        let sizes: number[];
        if ("lots" in action.size) {
          const total = this.roundLots(action.size.lots);
          const each = this.roundLots(total / n, "down");
          if (each < this.settings.minLot) return { ok: false, error: `That is less than ${this.settings.minLot} lots per order.` };
          sizes = prices.map(() => each);
          // The rounding remainder goes on the first orders, a step at a time.
          let rest = Math.round((total - each * n) / this.settings.lotStep);
          for (let i = 0; rest > 0; i = (i + 1) % n, rest--) sizes[i] = Math.round((sizes[i] + this.settings.lotStep) * 100) / 100;
        } else {
          const risk = action.size.risk;
          sizes = prices.map((p) => this.lotsForRisk(risk / n, p, action.sl));
          if (sizes.some((x) => x < this.settings.minLot)) return { ok: false, error: `That risk is too small for ${n} orders at ${this.settings.minLot} lots each.` };
        }
        const idea = this.idea(undefined, action.side, action.cancelRestOnClose ?? true);
        prices.forEach((p, i) => ids.push(this.place(idea, action.side, "limit", p, sizes[i], action.sl, action.tp ?? null, null)));
        break;
      }
      case "modify": {
        const pos = s.positions.find((p) => p.id === action.id);
        const ord = s.orders.find((o) => o.id === action.id);
        if (pos) {
          const sl = action.sl === undefined ? pos.sl : action.sl;
          const tp = action.tp === undefined ? pos.tp : action.tp;
          const bad = this.badStops(pos.side, pos.side === "buy" ? bid : ask, sl, tp, "position");
          if (bad) return { ok: false, error: bad };
          pos.sl = sl; pos.tp = tp;
        } else if (ord) {
          const price = action.price ?? ord.price;
          const sl = action.sl === undefined ? ord.sl : action.sl;
          const tp = action.tp === undefined ? ord.tp : action.tp;
          const bad = this.badOrderPrice(ord.side, ord.type, price) ?? this.badStops(ord.side, price, sl, tp, "order");
          if (bad) return { ok: false, error: bad };
          ord.price = price; ord.sl = sl; ord.tp = tp;
        } else return { ok: false, error: "That position or order is no longer open." };
        events.push({ kind: "modify", time: s.time, id: action.id });
        break;
      }
      case "cancel": {
        const i = s.orders.findIndex((o) => o.id === action.id);
        if (i < 0) return { ok: false, error: "That order is no longer open." };
        const [o] = s.orders.splice(i, 1);
        events.push({ kind: "cancel", time: s.time, orderId: o.id, ideaId: o.ideaId, why: "user" });
        this.settleIdea(o.ideaId, events);
        break;
      }
      case "cancelAll": {
        for (const o of [...s.orders]) {
          s.orders.splice(s.orders.indexOf(o), 1);
          events.push({ kind: "cancel", time: s.time, orderId: o.id, ideaId: o.ideaId, why: "user" });
          this.settleIdea(o.ideaId, events);
        }
        break;
      }
      case "close": {
        const pos = s.positions.find((p) => p.id === action.id);
        if (!pos) return { ok: false, error: "That position is no longer open." };
        let lots = pos.lots;
        if (action.lots !== undefined) {
          const want = this.roundLots(action.lots);
          if (want < this.settings.minLot) return { ok: false, error: `Close at least ${this.settings.minLot} lots.` };
          if (want < pos.lots && this.roundLots(pos.lots - want) < this.settings.minLot) return { ok: false, error: "That would leave less than the minimum lot open." };
          lots = Math.min(pos.lots, want);
        }
        this.closeLots(pos, lots, this.marketClose(pos.side), "user", events);
        break;
      }
      case "closeAll": {
        for (const p of [...s.positions]) if (!action.side || p.side === action.side) this.closeLots(p, p.lots, this.marketClose(p.side), "user", events);
        break;
      }
      case "breakeven": {
        const pos = s.positions.find((p) => p.id === action.id);
        if (!pos) return { ok: false, error: "That position is no longer open." };
        const buffer = action.buffer ?? 0;
        const sl = roundPrice(pos.side === "buy" ? pos.openPrice + buffer : pos.openPrice - buffer);
        const bad = this.badStops(pos.side, pos.side === "buy" ? bid : ask, sl, pos.tp, "position");
        if (bad) return { ok: false, error: `Breakeven is not possible yet: ${bad.toLowerCase()}` };
        pos.sl = sl;
        events.push({ kind: "modify", time: s.time, id: pos.id });
        break;
      }
      case "trail": {
        const pos = s.positions.find((p) => p.id === action.id);
        if (!pos) return { ok: false, error: "That position is no longer open." };
        if (action.distance !== null && !(action.distance > 0)) return { ok: false, error: "The trailing distance must be above zero." };
        pos.trail = action.distance;
        this.trailOne(pos);
        events.push({ kind: "modify", time: s.time, id: pos.id });
        break;
      }
    }
    return { ok: true, events, ids };
  }

  /* ----------------------------------------------------------- ticks */

  /** Process one recorded tick. Returns what it caused. */
  tick(time: number, recordedBid: number, recordedAsk: number): SimEvent[] {
    const s = this.state;
    const events: SimEvent[] = [];
    const bid = recordedBid;
    const sp = this.settings.spread;
    const ask = sp.mode === "recorded" ? recordedAsk
      : sp.mode === "fixed" ? roundPrice(bid + sp.value)
      : roundPrice(Math.max(bid, recordedAsk - sp.value));
    s.time = time; s.bid = bid; s.ask = ask;

    this.rollover(time);

    // Pending orders, oldest first.
    if (s.orders.length) {
      for (const o of [...s.orders]) {
        const hit = o.side === "buy"
          ? (o.type === "limit" ? ask <= o.price : ask >= o.price)
          : (o.type === "limit" ? bid >= o.price : bid <= o.price);
        if (!hit) continue;
        const price = o.type === "limit"
          ? (o.side === "buy" ? ask : bid)
          : (o.side === "buy" ? ask + this.settings.slippage : bid - this.settings.slippage);
        s.orders.splice(s.orders.indexOf(o), 1);
        this.open(s.ideas[o.ideaId] ?? this.idea(o.ideaId, o.side, false), o.side, o.lots, price, o.sl, o.tp, o.trail, o.type, events, o.id);
      }
    }

    // Stops, targets and trailing stops.
    if (s.positions.length) {
      for (const p of [...s.positions]) {
        if (p.trail) this.trailOne(p);
        if (p.side === "buy") {
          if (p.sl !== null && bid <= p.sl) this.closeLots(p, p.lots, bid - this.settings.slippage, "sl", events);
          else if (p.tp !== null && bid >= p.tp) this.closeLots(p, p.lots, bid, "tp", events);
        } else {
          if (p.sl !== null && ask >= p.sl) this.closeLots(p, p.lots, ask + this.settings.slippage, "sl", events);
          else if (p.tp !== null && ask <= p.tp) this.closeLots(p, p.lots, ask, "tp", events);
        }
      }
      this.stopOut(events);
    }
    return events;
  }

  /* ---------------------------------------------------------- inside */

  private id(prefix: string) { return `${prefix}${this.state.nextId++}`; }

  private idea(id: string | undefined, side: Side, cancelRestOnClose: boolean): Idea {
    if (id && this.state.ideas[id]) return this.state.ideas[id];
    const idea: Idea = { id: id ?? this.id("T"), side, risk: 0, openedAt: null, cancelRestOnClose, legs: [] };
    this.state.ideas[idea.id] = idea;
    return idea;
  }

  private open(idea: Idea, side: Side, lots: number, price: number, sl: number | null, tp: number | null, trail: number | null,
               from: "market" | "limit" | "stop", events: SimEvent[], id = this.id("P")): string {
    const s = this.state;
    const p: OpenPosition = {
      id, ideaId: idea.id, side, lots, openPrice: roundPrice(price), openTime: s.time, sl, tp, initialSl: sl,
      commission: -round2(this.settings.commissionPerLot * lots), swap: 0, trail,
    };
    s.positions.push(p);
    idea.openedAt ??= s.time;
    if (idea.risk !== null) idea.risk = sl === null ? null : idea.risk + Math.abs(p.openPrice - sl) * lots * this.settings.contractSize;
    events.push({ kind: "fill", time: s.time, positionId: id, ideaId: idea.id, side, lots, price: p.openPrice, from });
    if (p.trail) this.trailOne(p);
    return id;
  }

  private place(idea: Idea, side: Side, type: "limit" | "stop", price: number, lots: number, sl: number | null, tp: number | null, trail: number | null): string {
    const o: PendingOrder = { id: this.id("O"), ideaId: idea.id, side, type, price: roundPrice(price), lots, sl, tp, trail, createdTime: this.state.time };
    this.state.orders.push(o);
    return o.id;
  }

  private marketClose(side: Side) {
    return side === "buy" ? this.state.bid - this.settings.slippage : this.state.ask + this.settings.slippage;
  }

  private closeLots(p: OpenPosition, lots: number, price: number, reason: CloseReason, events: SimEvent[]) {
    const s = this.state;
    const share = lots / p.lots;
    const closePrice = roundPrice(price);
    const gross = round2((p.side === "buy" ? closePrice - p.openPrice : p.openPrice - closePrice) * lots * this.settings.contractSize);
    const openCommission = round2(p.commission * share);
    const closeCommission = -round2(this.settings.commissionPerLot * lots);
    const swap = round2(p.swap * share);
    const leg: ClosedLeg = {
      ticket: p.id, positionId: p.id, ideaId: p.ideaId, symbol: this.settings.symbol,
      direction: p.side === "buy" ? "long" : "short", lots: round2(lots),
      openedAt: p.openTime, closedAt: s.time, openPrice: p.openPrice, closePrice,
      stopLoss: p.sl, takeProfit: p.tp, commission: round2(openCommission + closeCommission), swap, profit: gross, closeReason: reason,
    };
    s.balance = round2(s.balance + gross + leg.commission + swap);
    if (lots >= p.lots - 1e-9) s.positions.splice(s.positions.indexOf(p), 1);
    else {
      p.lots = Math.round((p.lots - lots) * 100) / 100;
      p.commission = round2(p.commission - openCommission);
      p.swap = round2(p.swap - swap);
    }
    const idea = s.ideas[p.ideaId];
    idea?.legs.push(leg);
    events.push({ kind: "close", time: s.time, positionId: p.id, ideaId: p.ideaId, side: p.side, lots: leg.lots, price: closePrice, reason, profit: round2(gross + leg.commission + swap) });
    if (idea && reason !== "user" && idea.cancelRestOnClose && !s.positions.some((x) => x.ideaId === idea.id)) {
      for (const o of s.orders.filter((x) => x.ideaId === idea.id)) {
        s.orders.splice(s.orders.indexOf(o), 1);
        events.push({ kind: "cancel", time: s.time, orderId: o.id, ideaId: o.ideaId, why: "idea closed" });
      }
    }
    this.settleIdea(p.ideaId, events);
  }

  /** An idea with nothing left open or waiting is a finished trade. */
  private settleIdea(ideaId: string, events: SimEvent[]) {
    const s = this.state;
    const idea = s.ideas[ideaId];
    if (!idea) return;
    if (s.positions.some((p) => p.ideaId === ideaId) || s.orders.some((o) => o.ideaId === ideaId)) return;
    delete s.ideas[ideaId];
    if (!idea.legs.length) return; // orders cancelled before any filled: not a trade
    const pnl = round2(idea.legs.reduce((a, l) => a + l.profit + l.commission + l.swap, 0));
    const risk = idea.risk && idea.risk > 0 ? round2(idea.risk) : null;
    events.push({
      kind: "idea", time: s.time,
      idea: {
        id: idea.id, side: idea.side, legs: idea.legs, openedAt: idea.openedAt ?? idea.legs[0].openedAt, closedAt: s.time,
        pnl, risk, r: risk ? Math.round((pnl / risk) * 100) / 100 : null,
      },
    });
  }

  private trailOne(p: OpenPosition) {
    if (!p.trail) return;
    const { bid, ask } = this.state;
    if (p.side === "buy") {
      const want = roundPrice(bid - p.trail);
      // Starts once the stop would be at or past the entry, then only ever tightens.
      if (want >= p.openPrice && (p.sl === null || want > p.sl)) p.sl = want;
    } else {
      const want = roundPrice(ask + p.trail);
      if (want <= p.openPrice && (p.sl === null || want < p.sl)) p.sl = want;
    }
  }

  private rollover(time: number) {
    const s = this.state;
    const next = s.lastRollover + DAY_MS;
    if (time < next) return;
    const boundary = rolloverAtOrBefore(time);
    for (let r = next; r <= boundary; r += DAY_MS) {
      const wd = new Date(r).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const mult = wd === 3 ? 3 : 1;
      for (const p of s.positions) {
        const rate = p.side === "buy" ? this.settings.swapLong : this.settings.swapShort;
        if (rate) p.swap = round2(p.swap + rate * p.lots * mult);
      }
    }
    s.lastRollover = boundary;
  }

  private stopOut(events: SimEvent[]) {
    const s = this.state;
    for (let guard = 0; guard < 500 && s.positions.length; guard++) {
      const margin = this.margin();
      const equity = this.equity();
      const level = margin > 0 ? (equity / margin) * 100 : Infinity;
      if (level > this.settings.stopOutLevel && equity > 0) return;
      // Close the biggest loser first, as MT5 does.
      const worst = [...s.positions].sort((a, b) => this.floating(a) - this.floating(b))[0];
      this.closeLots(worst, worst.lots, this.marketClose(worst.side), "so", events);
    }
  }

  private validLots(lots: number): number | string {
    const v = this.roundLots(lots);
    if (!(v >= this.settings.minLot)) return `The smallest size is ${this.settings.minLot} lots.`;
    if (Math.abs(v - lots) > 1e-6) return `Lots go in steps of ${this.settings.lotStep}.`;
    return v;
  }

  private badOrderPrice(side: Side, type: "limit" | "stop", price: number): string | null {
    const { bid, ask } = this.state;
    if (!(price > 0)) return "Set a price for the order.";
    if (side === "buy" && type === "limit" && !(price < ask)) return "A buy limit goes below the current ask.";
    if (side === "buy" && type === "stop" && !(price > ask)) return "A buy stop goes above the current ask.";
    if (side === "sell" && type === "limit" && !(price > bid)) return "A sell limit goes above the current bid.";
    if (side === "sell" && type === "stop" && !(price < bid)) return "A sell stop goes below the current bid.";
    return null;
  }

  /** Stops must be on the losing side and targets on the winning side of `ref`. */
  private badStops(side: Side, ref: number, sl: number | null, tp: number | null, what: "position" | "order"): string | null {
    const at = what === "position" ? "the current price" : "the order price";
    if (side === "buy") {
      if (sl !== null && !(sl < ref)) return `A buy's stop-loss must be below ${at}.`;
      if (tp !== null && !(tp > ref)) return `A buy's take-profit must be above ${at}.`;
    } else {
      if (sl !== null && !(sl > ref)) return `A sell's stop-loss must be above ${at}.`;
      if (tp !== null && !(tp < ref)) return `A sell's take-profit must be below ${at}.`;
    }
    return null;
  }
}
