import type { ChartHandle } from "./handle";
import type { LineHit, TabKey, TradeLine, TradeLines } from "./trade-lines";

type Side = "buy" | "sell";

/** A level being set: a position's stop or target, or an order's price. */
export interface LineIntent { obj: string; role: "sl" | "tp" | "price"; price: number }

/**
 * Which level a drag from a position's entry makes: toward profit a target,
 * toward loss a stop. Decided by the CURRENT price the level would be checked
 * against (bid for a buy, ask for a sell), not by the entry — so dragging the
 * stop above the entry to lock in profit works, and the result is never a
 * level the broker would refuse.
 */
export function entryDragRole(side: Side, price: number, m: { bid: number; ask: number }): "sl" | "tp" {
  const ref = side === "buy" ? m.bid : m.ask;
  return side === "buy" ? (price < ref ? "sl" : "tp") : (price > ref ? "sl" : "tp");
}

type Mode =
  | { kind: "move"; role: "sl" | "tp" | "price" }
  | { kind: "create"; role: "sl" | "tp" }
  | { kind: "entry" }
  | { kind: "none" };

/**
 * Mouse and finger on the trade lines: drag a stop, a target or an order to a
 * new price; drag out from a position's entry label (or its SL / TP button) to
 * make a stop or a target; click a label's button to close, cancel or move to
 * breakeven; double-click a label to type an exact price.
 *
 * It listens on the chart's parent, in the capture phase, so it always sees a
 * press before the drawing kit and the chart do — whichever of them was set up
 * first — and takes the press only when it lands on a line's label or a
 * draggable line. A press that turns into a drag holds the chart still; a
 * click without movement never changes a level.
 */
export function attachLineInteraction(handle: ChartHandle, lines: TradeLines, opts: {
  priceStep: number;
  /** A drawing tool is armed, or the start is being picked: presses belong elsewhere. */
  busy: () => boolean;
  /** A drawing is under the pointer: leave bare-line grabs to it. */
  yieldTo?: () => boolean;
  market: () => { bid: number; ask: number };
  onPreview: (p: LineIntent | null) => void;
  onCommit: (p: LineIntent) => void;
  onAction: (line: TradeLine, key: Exclude<TabKey, "sl" | "tp">) => void;
  /** Type a price: `field` is the level asked for, or "all" for every level of the label double-clicked. */
  onEdit: (line: TradeLine, field: "sl" | "tp" | "price" | "all", at: { x: number; y: number }) => void;
}) {
  const { chart, series, host } = handle;
  const el = chart.chartElement();
  const target: HTMLElement = host.parentElement ?? host;
  const coarse = lines.coarse;
  let press: { pointerId: number; hit: LineHit; x0: number; y0: number; mode: Mode | null; last: LineIntent | null } | null = null;
  let lastClick: { id: string; t: number; x: number; y: number } | null = null;
  let saved: unknown = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inPane = (p: { x: number; y: number }) => {
    const size = chart.paneSize(0);
    return p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
  };
  const priceAt = (y: number) => {
    const p = series.coordinateToPrice(y);
    if (p === null) return null;
    return Math.round(Number(p) / opts.priceStep) * opts.priceStep;
  };
  const lock = () => {
    const o = chart.options() as unknown as { handleScroll: unknown; handleScale: unknown };
    saved = structuredClone({ handleScroll: o.handleScroll, handleScale: o.handleScale });
    chart.applyOptions({ handleScroll: false, handleScale: false });
  };
  const unlock = () => { if (saved) chart.applyOptions(saved as never); saved = null; };

  const modeFor = (hit: LineHit): Mode => {
    const { line, part } = hit;
    if (typeof part === "object") {
      if ((part.tab === "sl" || part.tab === "tp") && (line.role === "entry" || line.role === "order")) return { kind: "create", role: part.tab };
      return { kind: "none" };
    }
    if (line.role === "sl" || line.role === "tp") return { kind: "move", role: line.role };
    if (line.role === "order") return { kind: "move", role: "price" };
    if (line.role === "entry") return { kind: "entry" };
    return { kind: "none" };
  };

  const end = () => {
    if (!press) return;
    try { target.releasePointerCapture?.(press.pointerId); } catch { /* already released */ }
    press = null;
    unlock();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || opts.busy()) return;
    const p = local(e);
    if (!inPane(p)) return;
    const hit = lines.hitAt(p.x, p.y);
    if (!hit) return;
    if (hit.part === "line" && opts.yieldTo?.()) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    press = { pointerId: e.pointerId, hit, x0: p.x, y0: p.y, mode: null, last: null };
    lock();
    try { target.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (!press || e.pointerId !== press.pointerId) {
      if (e.pointerType === "mouse" && !opts.busy()) {
        const h = inPane(p) ? lines.hitAt(p.x, p.y) : null;
        lines.setHover(h ? { id: h.line.id, tab: typeof h.part === "object" ? h.part.tab : null } : null);
      }
      return;
    }
    e.stopImmediatePropagation();
    if (!press.mode) {
      const moved = Math.hypot(p.x - press.x0, p.y - press.y0);
      if (moved < (e.pointerType === "touch" ? 8 : 4)) return;
      press.mode = modeFor(press.hit);
    }
    const mode = press.mode;
    if (mode.kind === "none") return;
    const price = priceAt(p.y);
    if (price === null || !(price > 0)) return;
    const line = press.hit.line;
    const role = mode.kind === "entry" ? entryDragRole(line.side ?? "buy", price, opts.market()) : mode.role;
    press.last = { obj: line.obj, role, price };
    opts.onPreview(press.last);
  };

  const onUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) return;
    e.stopImmediatePropagation();
    const { hit, mode, last } = press;
    const p = local(e);
    end();
    if (mode && mode.kind !== "none") {
      if (last) opts.onCommit(last); else opts.onPreview(null);
      return;
    }
    // A click.
    const r = el.getBoundingClientRect();
    const pill = lines.pillOf(hit.line.id);
    const at = { x: r.left + (pill ? pill.x : p.x), y: r.top + (pill ? pill.y + pill.h / 2 : p.y) };
    if (typeof hit.part === "object") {
      const key = hit.part.tab;
      if (key === "sl" || key === "tp") opts.onEdit(hit.line, key, at);
      else opts.onAction(hit.line, key);
      lastClick = null;
      return;
    }
    const now = performance.now();
    if (lastClick && lastClick.id === hit.line.id && now - lastClick.t < 400 && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 24) {
      lastClick = null;
      const field = hit.line.role === "sl" ? "sl" : hit.line.role === "tp" ? "tp" : "all";
      opts.onEdit(hit.line, field, at);
    } else lastClick = { id: hit.line.id, t: now, x: p.x, y: p.y };
  };

  const onCancel = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) return;
    end();
    opts.onPreview(null);
  };

  /** The chart's own double-click (and the kit's) never sees one made on a line. */
  const onDbl = (e: MouseEvent) => {
    const p = local(e);
    if (inPane(p) && lines.hitAt(p.x, p.y)) { e.stopImmediatePropagation(); e.preventDefault(); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && press?.mode && press.mode.kind !== "none") {
      e.preventDefault();
      end();
      opts.onPreview(null);
    }
  };

  const onLeave = () => lines.setHover(null);

  target.addEventListener("pointerdown", onDown, true);
  target.addEventListener("pointermove", onMove, true);
  target.addEventListener("pointerup", onUp, true);
  target.addEventListener("pointercancel", onCancel, true);
  target.addEventListener("dblclick", onDbl, true);
  target.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey);
  return () => {
    target.removeEventListener("pointerdown", onDown, true);
    target.removeEventListener("pointermove", onMove, true);
    target.removeEventListener("pointerup", onUp, true);
    target.removeEventListener("pointercancel", onCancel, true);
    target.removeEventListener("dblclick", onDbl, true);
    target.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("keydown", onKey);
    unlock();
    lines.setHover(null);
  };
}
