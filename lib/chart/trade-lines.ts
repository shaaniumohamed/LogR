import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";
import type { ChartHandle } from "./handle";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface TradeLine {
  /** `${positionOrOrderId}:${"entry" | "sl" | "tp" | "price"}` */
  id: string;
  price: number;
  label: string;
  color: string;
  draggable: boolean;
  dashed?: boolean;
  /** Also label the price on the axis (entries, orders and a position's stop and target). */
  axis?: boolean;
}

/**
 * Open positions and pending orders as lines across the chart, MT5-style:
 * the entry, the stop, the target and each order's price, with a label at
 * the right end and the price on the axis. Painted by the chart itself, so
 * they move with every zoom and pan.
 */
export class TradeLines implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private lines: TradeLine[] = [];
  private ys: (number | null)[] = [];
  private views: IPrimitivePaneView[];
  private axis: ISeriesPrimitiveAxisView[] = [];

  constructor(private readonly font: string, private readonly decimals: number) {
    this.views = [{ zOrder: () => "top", renderer: () => ({ draw: (t) => this.draw(t) }) }];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) { this.chart = chart as IChartApi; this.series = series; this.requestUpdate = requestUpdate; }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }

  set(lines: TradeLine[]) {
    this.lines = lines;
    this.axis = lines.map((l, i) => ({
      coordinate: () => this.ys[i] ?? -100,
      text: () => l.price.toFixed(this.decimals),
      textColor: () => "#ffffff",
      backColor: () => l.color,
      visible: () => !!l.axis && this.ys[i] !== null,
    }));
    this.requestUpdate?.();
  }

  get all(): readonly TradeLine[] { return this.lines; }

  /** The line nearest `y` (pane pixels) within `tolerance`, draggable ones only. */
  hit(y: number, tolerance: number): TradeLine | null {
    let best: TradeLine | null = null, dist = tolerance;
    this.lines.forEach((l, i) => {
      const ly = this.ys[i];
      if (!l.draggable || ly === null) return;
      const d = Math.abs(ly - y);
      if (d <= dist) { dist = d; best = l; }
    });
    return best;
  }

  updateAllViews() {
    const s = this.series;
    // Off the top or bottom of the chart is null: no line, and no axis label
    // pinned to the edge as if the price were on screen.
    const h = this.chart?.paneSize(0).height ?? Infinity;
    this.ys = this.lines.map((l) => {
      const y = s ? s.priceToCoordinate(l.price) : null;
      return y === null || y < 0 || y > h ? null : y;
    });
  }

  paneViews() { return this.views; }
  priceAxisViews() { return this.axis; }

  private draw(target: Target) {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.font = `600 ${Math.round(11 * vr)}px ${this.font}`;
      ctx.textBaseline = "middle";
      this.lines.forEach((l, i) => {
        const yc = this.ys[i];
        if (yc === null) return;
        const y = Math.round(yc * vr) + 0.5;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash(l.dashed ? [Math.round(5 * hr), Math.round(4 * hr)] : []);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bitmapSize.width, y); ctx.stroke();
        ctx.setLineDash([]);
        // The label, at the right end, in the line's colour.
        const pad = 5 * hr;
        const w = ctx.measureText(l.label).width + pad * 2;
        const h = Math.round(18 * vr);
        const x = bitmapSize.width - w - 6 * hr;
        ctx.fillStyle = l.color;
        ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 3 * hr); ctx.fill();
        if (l.draggable) {
          // Grip marks: this one can be dragged.
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          for (let k = -1; k <= 1; k++) ctx.fillRect(x - 7 * hr, y + k * 3 * vr - 0.5 * vr, 4 * hr, 1 * vr);
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(l.label, x + pad, y + 0.5 * vr);
      });
      ctx.restore();
    });
  }
}

/**
 * Dragging a stop, target or order line with a mouse or a finger.
 *
 * Listens on the chart's container in the capture phase, ahead of the drawing
 * kit, and takes the gesture only when it starts on a draggable line — a
 * finger gets a wider band than a mouse. While dragging, the chart is held
 * still and `onPreview` shows the price; `onCommit` fires on release.
 */
export function attachLineDrag(handle: ChartHandle, lines: TradeLines, opts: {
  priceStep: number;
  /** A drawing tool is in hand: the press belongs to the drawing, not a line. */
  busy: () => boolean;
  onPreview: (id: string, price: number) => void;
  onCommit: (id: string, price: number) => void;
}) {
  const { chart, series, host } = handle;
  const el = chart.chartElement();
  let drag: { id: string; pointerId: number; price: number } | null = null;
  let saved: unknown = null;

  const paneY = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top;
  const inPane = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const pane = chart.paneSize(0);
    return x >= 0 && y >= 0 && x <= pane.width && y <= pane.height;
  };
  const priceAt = (y: number) => {
    const p = series.coordinateToPrice(y);
    if (p === null) return null;
    return Math.round(Number(p) / opts.priceStep) * opts.priceStep;
  };

  const onDown = (e: PointerEvent) => {
    if (opts.busy() || !inPane(e) || e.button !== 0) return;
    const hit = lines.hit(paneY(e), e.pointerType === "touch" ? 16 : 6);
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    drag = { id: hit.id, pointerId: e.pointerId, price: hit.price };
    const o = chart.options() as unknown as { handleScroll: unknown; handleScale: unknown };
    saved = structuredClone({ handleScroll: o.handleScroll, handleScale: o.handleScale });
    chart.applyOptions({ handleScroll: false, handleScale: false });
    host.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pointerId) {
      e.stopImmediatePropagation();
      const p = priceAt(paneY(e));
      if (p !== null && p > 0) { drag.price = p; opts.onPreview(drag.id, p); }
      return;
    }
    if (e.pointerType === "mouse" && !opts.busy()) {
      host.style.cursor = inPane(e) && lines.hit(paneY(e), 6) ? "ns-resize" : "";
    }
  };
  const finish = (e: PointerEvent, commit: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopImmediatePropagation();
    const d = drag;
    drag = null;
    if (saved) chart.applyOptions(saved as never);
    saved = null;
    host.releasePointerCapture?.(e.pointerId);
    if (commit) opts.onCommit(d.id, d.price);
  };
  const onUp = (e: PointerEvent) => finish(e, true);
  const onCancel = (e: PointerEvent) => finish(e, false);

  host.addEventListener("pointerdown", onDown, true);
  host.addEventListener("pointermove", onMove, true);
  host.addEventListener("pointerup", onUp, true);
  host.addEventListener("pointercancel", onCancel, true);
  return () => {
    host.removeEventListener("pointerdown", onDown, true);
    host.removeEventListener("pointermove", onMove, true);
    host.removeEventListener("pointerup", onUp, true);
    host.removeEventListener("pointercancel", onCancel, true);
    if (saved) chart.applyOptions(saved as never);
    host.style.cursor = "";
  };
}
