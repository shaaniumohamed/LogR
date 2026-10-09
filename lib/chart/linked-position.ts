import type { Drawing } from "lightweight-charts-drawing";
import type { SimAction, Side } from "@/lib/core/sim/broker";

/**
 * A Long/Short Position drawing that has become a real order, and stays tied
 * to it: drag the drawing's stop or target edge and the order's stop-loss or
 * take-profit moves; move them anywhere else and the drawing follows.
 *
 * The broker is the truth for the trade; the drawing is a view of it and a
 * handle to change it. These helpers are the two directions of that, kept
 * pure so they are tested without a chart: what the drawing should look like
 * for the trade as it is, and what a change the trader made to the drawing
 * asks the broker to do.
 */

export interface LinkedTrade {
  /** Position or order id (the same id once an order fills). */
  id: string;
  side: Side;
  kind: "order" | "position";
  /** The order's price, or the position's fill price. */
  entry: number;
  sl: number | null;
  tp: number | null;
}

/** Where a link is kept: in the session's chart settings, by drawing id. */
export type { BtLink } from "@/lib/core/backtest";

const EPS = 1e-6;
const isPosition = (d: Drawing) => d.kind === "long-position" || d.kind === "short-position";

/** The money the drawing's own risk settings put at stake, as the kit computes its Qty. */
export function riskMoneyOf(style: Drawing["style"], equity: number): number {
  const account = style.accountSize ?? equity;
  if (style.riskDisplayMode === "money") return Math.min(style.riskAmount ?? 0, account);
  return (account * (style.riskPercent ?? 0)) / 100;
}

/** Entry, stop and target prices the drawing currently shows. */
export function levelsOf(d: Drawing): { entry: number; sl: number | null; tp: number | null; side: Side } | null {
  if (!isPosition(d) || !d.points[0]) return null;
  const side: Side = d.kind === "long-position" ? "buy" : "sell";
  const entry = d.points[0].price;
  const s = d.style.stopLevel, p = d.style.profitLevel;
  const dir = side === "buy" ? 1 : -1;
  return {
    side, entry,
    sl: s !== undefined && s > 0 ? entry - dir * s : null,
    tp: p !== undefined && p > 0 ? entry + dir * p : null,
  };
}

/**
 * The drawing as it should be for the trade, or null when it already is.
 *
 * Returning null when nothing differs is what makes the sync loop-free: the
 * drawing is only ever written when the trade has truly moved. A trade with
 * no stop (or no target) keeps that edge at its last distance but faint, so
 * the trader can see where it was and drag it to set one.
 */
export function desiredDrawing(d: Drawing, t: LinkedTrade): Drawing | null {
  if (!isPosition(d) || !d.points[0]) return null;
  const dir = t.side === "buy" ? 1 : -1;
  const stopLevel = t.sl === null ? (d.style.stopLevel ?? 0) : Math.round(dir * (t.entry - t.sl) * 1e5) / 1e5;
  const profitLevel = t.tp === null ? (d.style.profitLevel ?? 0) : Math.round(dir * (t.tp - t.entry) * 1e5) / 1e5;
  const stopTransparency = t.sl === null ? 95 : undefined;
  const targetTransparency = t.tp === null ? 95 : undefined;
  const same = Math.abs(d.points[0].price - t.entry) < EPS
    && Math.abs((d.style.stopLevel ?? 0) - stopLevel) < EPS
    && Math.abs((d.style.profitLevel ?? 0) - profitLevel) < EPS
    && d.style.stopTransparency === stopTransparency
    && d.style.targetTransparency === targetTransparency;
  if (same) return null;
  const shift = t.entry - d.points[0].price;
  const points = d.points.map((p) => ({ ...p, price: p.price + shift })) as Drawing["points"];
  return { ...d, points, style: { ...d.style, stopLevel, profitLevel, stopTransparency, targetTransparency } } as Drawing;
}

/**
 * What a change the trader made to a linked drawing asks of the broker.
 *
 *  - The entry moved: a pending order moves with its stop and target (the
 *    whole setup shifts, as the drawing did); a filled position cannot move
 *    its entry, so the drawing is put back.
 *  - The stop or target edge moved: modify that level.
 *  - Only its time or look changed: nothing.
 */
export function intentFromChange(prev: Drawing, next: Drawing, t: LinkedTrade, step = 0.01):
  { actions: SimAction[] } | { revert: string } | null {
  const a = levelsOf(prev), b = levelsOf(next);
  if (!a || !b) return null;
  const snap = (v: number | null) => (v === null ? null : Math.round(v / step) * step);
  const moved = (x: number | null, y: number | null) => (x === null) !== (y === null) || (x !== null && y !== null && Math.abs(x - y) > step / 2);
  if (moved(a.entry, b.entry)) {
    if (t.kind === "position") return { revert: "That trade is filled — drag its stop or target edge instead." };
    return { actions: [{ kind: "modify", id: t.id, price: snap(b.entry)!, sl: snap(b.sl), tp: snap(b.tp) }] };
  }
  const change: { sl?: number | null; tp?: number | null } = {};
  if (moved(a.sl, b.sl)) change.sl = snap(b.sl);
  if (moved(a.tp, b.tp)) change.tp = snap(b.tp);
  if (!("sl" in change) && !("tp" in change)) return null;
  return { actions: [{ kind: "modify", id: t.id, ...change }] };
}

/** A closed trade's drawing, kept as a record: stretched to the exit, faded, and locked. */
export function frozenDrawing(d: Drawing, exitTime: number): Drawing {
  const points = d.points.map((p, i) => (i === 1 ? { ...p, time: Math.max(p.time as number, exitTime) } : p)) as Drawing["points"];
  return { ...d, points, locked: true, style: { ...d.style, stopTransparency: 90, targetTransparency: 90 } } as Drawing;
}
