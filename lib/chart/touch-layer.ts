import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { DrawingManager } from "lightweight-charts-drawing";
import { OVERLAY_SPECS } from "lightweight-charts-drawing";

/**
 * Making the drawing kit work with a finger.
 *
 * The kit is built for a mouse: a click places a point exactly where the
 * cursor is. A finger has no cursor, covers the very spot it is placing, and
 * shares the screen with the page's own scrolling. This layer sits in front of
 * the kit — listening on the chart's container in the capture phase, so it
 * sees every touch before the kit does — and changes four things, all
 * confirmed in the trial recorded in docs/30-backtesting.md:
 *
 *  1. With a tool armed, a press is held back. A magnifier above the finger
 *     shows what is underneath, with the exact price and time; the point is
 *     placed where the finger LIFTS. Slide to the spot, then let go.
 *  2. While a tool is armed or a drawing is selected, the chart claims the
 *     gesture (`touch-action: none`), so dragging never scrolls the page and a
 *     brush stroke is not cancelled halfway.
 *  3. A double-tap does what a double-click does (edit a text drawing); a
 *     long-press on a drawing asks the host to open its settings.
 *  4. A second finger abandons the point being placed.
 *
 * The kit itself is untouched: everything it receives is an ordinary pointer
 * event, re-sent at the right place. Mouse and pen input pass straight through.
 */

export interface TouchLayerOptions {
  formatPrice: (price: number) => string;
  formatTime: (epochSec: number) => string;
  /** A drawing was long-pressed (the kit has already selected it). */
  onLongPress?: (id: string) => void;
  /**
   * Whether a finger dragging over the chart with nothing armed may scroll the
   * page vertically — yes inside a scrolling page, no in a full-screen chart.
   */
  pageScroll?: boolean;
}

export interface TouchLayer {
  detach(): void;
  /** Change whether an idle chart lets a finger scroll the page (entering or leaving full screen). */
  setPageScroll(on: boolean): void;
}

const LONG_PRESS_MS = 550;
const MOVE_SLOP = 10;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 28;
const LOUPE = 116;
const ZOOM = 2;

export function attachTouchLayer(
  host: HTMLElement,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  dm: DrawingManager,
  opts: TouchLayerOptions,
): TouchLayer {
  const el = chart.chartElement();
  const originalTouchAction = host.style.touchAction;

  /* ------------------------------------------------ who owns the gesture */

  const syncTouchAction = () => {
    const claim = !opts.pageScroll || !!dm.tool() || dm.selection().length > 0;
    host.style.touchAction = claim ? "none" : originalTouchAction;
  };
  syncTouchAction();
  const offTool = dm.on("tool", syncTouchAction);
  const offSel = dm.on("selection", syncTouchAction);

  let savedScroll: { handleScroll: unknown; handleScale: unknown } | null = null;
  const lockChart = () => {
    if (savedScroll) return;
    const o = chart.options() as unknown as { handleScroll: unknown; handleScale: unknown };
    savedScroll = structuredClone({ handleScroll: o.handleScroll, handleScale: o.handleScale });
    chart.applyOptions({ handleScroll: false, handleScale: false });
  };
  const unlockChart = () => {
    if (!savedScroll) return;
    chart.applyOptions(savedScroll as never);
    savedScroll = null;
  };

  /* --------------------------------------------------------- geometry */

  const local = (e: PointerEvent | MouseEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inPane = (e: PointerEvent) => {
    const { x, y } = local(e);
    const pane = chart.paneSize(0);
    return x >= 0 && y >= 0 && x <= pane.width && y <= pane.height;
  };

  /** Re-send a pointer event to the kit at a viewport position. */
  const send = (type: string, clientX: number, clientY: number, pointerId: number) => {
    el.dispatchEvent(new PointerEvent(type, {
      clientX, clientY, pointerId, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      button: type === "pointermove" ? -1 : 0, buttons: type === "pointerdown" ? 1 : 0,
    }));
  };
  const sendDoubleClick = (clientX: number, clientY: number) => {
    el.dispatchEvent(new MouseEvent("dblclick", { clientX, clientY, bubbles: true, cancelable: true, button: 0 }));
  };

  /* ----------------------------------------------------------- loupe */

  const loupe = document.createElement("div");
  Object.assign(loupe.style, {
    position: "fixed", width: `${LOUPE}px`, height: `${LOUPE}px`, borderRadius: "50%", overflow: "hidden",
    pointerEvents: "none", zIndex: "90", display: "none",
    boxShadow: "0 6px 24px rgb(0 0 0 / 0.28), 0 0 0 2px rgb(255 255 255 / 0.9)", background: "#000",
  } satisfies Partial<CSSStyleDeclaration>);
  const lens = document.createElement("canvas");
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  lens.width = lens.height = LOUPE * dpr;
  Object.assign(lens.style, { width: "100%", height: "100%" });
  loupe.appendChild(lens);
  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "fixed", pointerEvents: "none", zIndex: "90", display: "none", padding: "2px 7px", borderRadius: "6px",
    font: "600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#fff", background: "rgb(0 0 0 / 0.78)",
    whiteSpace: "nowrap", transform: "translateX(-50%)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(loupe, label);

  let snapshot: HTMLCanvasElement | null = null;
  const showLoupe = (e: PointerEvent) => {
    try { snapshot = chart.takeScreenshot(); } catch { snapshot = null; }
    loupe.style.display = "block";
    label.style.display = "block";
    moveLoupe(e);
  };
  const moveLoupe = (e: PointerEvent) => {
    const { x, y } = local(e);
    // Above the finger; below it when there is no room above.
    const above = e.clientY - LOUPE - 64 > 8;
    const top = above ? e.clientY - LOUPE - 64 : e.clientY + 48;
    const left = Math.min(window.innerWidth - LOUPE - 8, Math.max(8, e.clientX - LOUPE / 2));
    loupe.style.transform = `translate(${left}px, ${top}px)`;
    loupe.style.left = loupe.style.top = "0";
    label.style.left = `${left + LOUPE / 2}px`;
    label.style.top = `${top + LOUPE + 6}px`;

    const ctx = lens.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#000";
      ctx.fillRect(0, 0, lens.width, lens.height);
      if (snapshot) {
        // The screenshot is in device pixels; take the square around the finger.
        const k = snapshot.width / el.clientWidth;
        const half = (LOUPE / ZOOM / 2) * k;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(snapshot, x * k - half, y * k - half, half * 2, half * 2, 0, 0, lens.width, lens.height);
      }
      const c = lens.width / 2;
      ctx.strokeStyle = "rgb(255 255 255 / 0.95)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(c, 0); ctx.lineTo(c, lens.height);
      ctx.moveTo(0, c); ctx.lineTo(lens.width, c);
      ctx.stroke();
      ctx.strokeStyle = "rgb(0 0 0 / 0.5)";
      ctx.lineWidth = 0.75 * dpr;
      ctx.stroke();
    }
    const price = series.coordinateToPrice(y);
    const time = chart.timeScale().coordinateToTime(x);
    label.textContent = [
      price === null ? "" : opts.formatPrice(Number(price)),
      typeof time === "number" ? opts.formatTime(time) : "",
    ].filter(Boolean).join("  ·  ");
  };
  const hideLoupe = () => {
    loupe.style.display = "none";
    label.style.display = "none";
    snapshot = null;
  };

  /* ---------------------------------------------------------- gestures */

  // A press held back while a tool is armed.
  let held: { id: number; x: number; y: number } | null = null;
  // Any other touch: for long-press, double-tap and the loupe during a drag.
  let touch: { id: number; x: number; y: number; at: number; timer: number; moved: boolean; loupe: boolean } | null = null;
  let lastTap: { x: number; y: number; at: number } | null = null;
  let lastTouchAt = 0;
  // Fingers whose events are kept from the kit until they lift: with a tool
  // armed, every touch is ours, or a second finger would place a point.
  const swallowed = new Set<number>();
  const chartHeld = () => {
    // The kit takes the gesture from the chart when it grabs a drawing; the
    // chart reports that back as scrolling switched off in every direction.
    const hs = (chart.options() as unknown as { handleScroll: false | Record<string, boolean> }).handleScroll;
    return hs === false || (!!hs && hs.pressedMouseMove === false && hs.horzTouchDrag === false && hs.vertTouchDrag === false);
  };

  const isTouch = (e: PointerEvent) => e.isTrusted && e.pointerType === "touch";
  const freehand = () => {
    const k = dm.tool();
    return !!k && !!(OVERLAY_SPECS as Record<string, { freehand?: boolean }>)[k]?.freehand;
  };

  const onDown = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    lastTouchAt = Date.now();

    // A second finger: give up on the point being placed, and let the chart
    // have the pinch. Neither finger reaches the kit.
    if (held && e.pointerId !== held.id) {
      e.stopPropagation();
      swallowed.add(held.id).add(e.pointerId);
      held = null; hideLoupe(); unlockChart();
      return;
    }

    if (dm.tool() && !freehand() && inPane(e)) {
      e.stopPropagation();
      // Another finger is already down (a pinch that started before the tool
      // was armed, or the rest of a cancelled placement): not a placement.
      if (swallowed.size) { swallowed.add(e.pointerId); return; }
      held = { id: e.pointerId, x: e.clientX, y: e.clientY };
      lockChart();
      showLoupe(e);
      send("pointermove", e.clientX, e.clientY, e.pointerId);
      return;
    }

    if (!dm.tool() && inPane(e) && e.isPrimary) {
      const t = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now(), timer: 0, moved: false, loupe: false };
      t.timer = window.setTimeout(() => {
        if (touch !== t || t.moved) return;
        const id = dm.selection()[0];
        if (id) opts.onLongPress?.(id);
      }, LONG_PRESS_MS);
      touch = t;
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    if (swallowed.has(e.pointerId)) { e.stopPropagation(); return; }
    if (held && e.pointerId === held.id) {
      e.stopPropagation();
      held.x = e.clientX; held.y = e.clientY;
      moveLoupe(e);
      // Keep the kit's rubber-band preview following the finger.
      send("pointermove", e.clientX, e.clientY, e.pointerId);
      return;
    }
    if (touch && e.pointerId === touch.id) {
      if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > MOVE_SLOP) {
        touch.moved = true;
        // The kit grabbed a drawing (it stops the chart scrolling when it does):
        // show the magnifier while it is dragged, so the finger hides nothing.
        if (!touch.loupe && dm.selection().length && chartHeld()) {
          touch.loupe = true;
          showLoupe(e);
        }
      }
      if (touch.loupe) moveLoupe(e);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    if (swallowed.delete(e.pointerId)) { e.stopPropagation(); return; }
    if (held && e.pointerId === held.id) {
      e.stopPropagation();
      const { x, y } = { x: e.clientX, y: e.clientY };
      held = null;
      hideLoupe();
      send("pointermove", x, y, e.pointerId);
      send("pointerdown", x, y, e.pointerId);
      send("pointerup", x, y, e.pointerId);
      unlockChart();
      return;
    }
    if (touch && e.pointerId === touch.id) {
      window.clearTimeout(touch.timer);
      if (touch.loupe) hideLoupe();
      const wasTap = !touch.moved && Date.now() - touch.at < LONG_PRESS_MS;
      touch = null;
      if (wasTap) {
        const now = Date.now();
        if (lastTap && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
          lastTap = null;
          sendDoubleClick(e.clientX, e.clientY);
        } else {
          lastTap = { x: e.clientX, y: e.clientY, at: now };
        }
      }
    }
  };

  const onCancel = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    swallowed.delete(e.pointerId);
    if (held && e.pointerId === held.id) { held = null; hideLoupe(); unlockChart(); }
    if (touch && e.pointerId === touch.id) { window.clearTimeout(touch.timer); if (touch.loupe) hideLoupe(); touch = null; }
  };

  // The browser's own double-click after two taps would reach the kit twice
  // (ours and its); keep only ours.
  const onDblClick = (e: MouseEvent) => {
    if (e.isTrusted && Date.now() - lastTouchAt < 800) e.stopPropagation();
  };

  host.addEventListener("pointerdown", onDown, true);
  host.addEventListener("pointermove", onMove, true);
  host.addEventListener("pointerup", onUp, true);
  host.addEventListener("pointercancel", onCancel, true);
  host.addEventListener("dblclick", onDblClick, true);

  return {
    setPageScroll(on) {
      opts.pageScroll = on;
      syncTouchAction();
    },
    detach() {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove, true);
      host.removeEventListener("pointerup", onUp, true);
      host.removeEventListener("pointercancel", onCancel, true);
      host.removeEventListener("dblclick", onDblClick, true);
      offTool();
      offSel();
      if (touch) window.clearTimeout(touch.timer);
      unlockChart();
      loupe.remove();
      label.remove();
      host.style.touchAction = originalTouchAction;
    },
  };
}

/** Finish a path or polyline being placed, as the kit's double-click would (the Done button). */
export function finishPlacement(chart: IChartApi) {
  const el = chart.chartElement();
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("dblclick", { clientX: r.left + 10, clientY: r.top + 10, bubbles: true, cancelable: true, button: 0 }));
}
