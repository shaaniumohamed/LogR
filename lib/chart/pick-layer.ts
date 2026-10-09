import type { ChartHandle } from "./handle";
import type { PickOverlay } from "./pick-overlay";

export interface PickedCandle { time: number; x: number }

/**
 * Picking the replay's start on the chart.
 *
 * With a mouse the line follows the pointer and a click starts the replay
 * there; dragging still scrolls the chart and the wheel still zooms, so
 * finding the spot works as it always does. With a finger the line stays put
 * until it is dragged by itself (or a tap moves it), and a "Start here"
 * button commits — a tap is too easy to make by accident.
 *
 * The line is kept at a screen position, and the candle under it is worked
 * out again whenever the chart scrolls or zooms underneath.
 */
export function attachPickLayer(handle: ChartHandle, overlay: PickOverlay, opts: {
  coarse: boolean;
  candleAt: (x: number) => PickedCandle | null;
  label: (time: number) => string;
  onChange: (c: PickedCandle | null) => void;
  onPick: (c: PickedCandle) => void;
}) {
  const { chart, host } = handle;
  const el = chart.chartElement();
  const target: HTMLElement = host.parentElement ?? host;
  let screenX: number | null = null;
  let down: { id: number; x: number; y: number; t: number; line: boolean } | null = null;

  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inPane = (p: { x: number; y: number }) => {
    const s = chart.paneSize(0);
    return p.x >= 0 && p.y >= 0 && p.x <= s.width && p.y <= s.height;
  };
  const update = () => {
    const c = screenX === null ? null : opts.candleAt(screenX);
    overlay.set(c ? c.x : null, c ? opts.label(c.time) : "");
    opts.onChange(c);
    return c;
  };
  const moveTo = (x: number) => { screenX = x; return update(); };

  if (opts.coarse) moveTo(chart.paneSize(0).width * 0.7);

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = local(e);
    if (!inPane(p)) return;
    const onLine = opts.coarse && overlay.position !== null && Math.abs(p.x - overlay.position) <= 22;
    down = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), line: onLine };
    if (onLine) {
      // Dragging the line itself: the chart stays still.
      e.stopImmediatePropagation();
      e.preventDefault();
      try { target.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (down?.line && e.pointerId === down.id) { e.stopImmediatePropagation(); moveTo(p.x); return; }
    if (!opts.coarse && e.pointerType === "mouse" && inPane(p)) moveTo(p.x);
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return;
    const p = local(e);
    const d = down;
    down = null;
    if (d.line) { e.stopImmediatePropagation(); try { target.releasePointerCapture?.(e.pointerId); } catch { /* released */ } return; }
    const still = Math.hypot(p.x - d.x, p.y - d.y) < (e.pointerType === "touch" ? 8 : 4) && performance.now() - d.t < 500;
    if (!still || !inPane(p)) return;
    if (opts.coarse || e.pointerType !== "mouse") { moveTo(p.x); return; }
    const c = moveTo(p.x);
    if (c) opts.onPick(c);
  };
  const onRange = () => update();

  target.addEventListener("pointerdown", onDown, true);
  target.addEventListener("pointermove", onMove, true);
  target.addEventListener("pointerup", onUp, true);
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
  return {
    /** The candle under the line now, for a "Start here" button. */
    current: () => (screenX === null ? null : opts.candleAt(screenX)),
    detach() {
      target.removeEventListener("pointerdown", onDown, true);
      target.removeEventListener("pointermove", onMove, true);
      target.removeEventListener("pointerup", onUp, true);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); } catch { /* chart gone */ }
      overlay.set(null, "");
    },
  };
}
