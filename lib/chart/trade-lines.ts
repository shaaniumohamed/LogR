import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem, SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Side = "buy" | "sell";

/** What a line stands for. */
export type LineRole = "entry" | "sl" | "tp" | "order" | "ask" | "ghost";
/** The buttons on a line's label. */
export type TabKey = "sl" | "tp" | "be" | "close" | "remove" | "cancel";

export interface LineTab { key: TabKey; text: string; title: string }

export interface TradeLine {
  /** `${obj}:${role}` */
  id: string;
  /** The position or order it belongs to ("" for the ask line and previews). */
  obj: string;
  role: LineRole;
  side?: Side;
  price: number;
  label: string;
  color: string;
  /** The line itself can be dragged (a stop, a target, an order's price). */
  draggable: boolean;
  dashed?: boolean;
  dotted?: boolean;
  /** Also label the price on the axis. */
  axis?: boolean;
  tabs?: LineTab[];
  /** A thin line with no label (the ask). */
  bare?: boolean;
}

export type LineHit = { line: TradeLine; part: "line" | "label" | { tab: TabKey } };

/** Where a line's label box sits, in CSS pixels of the pane. */
export interface Pill {
  line: TradeLine;
  /** The level's own y. */
  lineY: number;
  x: number;
  y: number;
  w: number;
  h: number;
  grip: boolean;
  labelX: number;
  tabs: { key: TabKey; text: string; x: number; w: number }[];
}

const PAD = 6;
const GRIP = 10;

/**
 * Lay the labels out at the right of the pane, one per line, and push apart
 * any that would overlap — a stop a few cents from the entry sits on the same
 * pixel row on an hourly chart, and stacked labels would leave neither one's
 * buttons clickable. A label moved off its line is joined to it by a short
 * connector when drawn.
 */
export function layoutPills(
  lines: readonly TradeLine[], ys: readonly (number | null)[],
  o: { width: number; height: number; coarse: boolean; measure: (text: string) => number },
): Pill[] {
  const h = o.coarse ? 26 : 18;
  const tabMin = o.coarse ? 32 : 22;
  const pills: Pill[] = [];
  lines.forEach((line, i) => {
    const y = ys[i];
    if (y === null || y === undefined || line.bare) return;
    const grip = line.draggable || line.role === "entry";
    const labelW = o.measure(line.label) + PAD * 2;
    const tabs = (line.tabs ?? []).map((t) => ({ key: t.key, text: t.text, x: 0, w: Math.max(tabMin, o.measure(t.text) + 10) }));
    const w = (grip ? GRIP : 0) + labelW + tabs.reduce((a, t) => a + t.w, 0);
    const x = o.width - 8 - w;
    let tx = x + (grip ? GRIP : 0) + labelW;
    for (const t of tabs) { t.x = tx; tx += t.w; }
    pills.push({ line, lineY: y, x, y: y - h / 2, w, h, grip, labelX: x + (grip ? GRIP : 0) + PAD, tabs });
  });
  pills.sort((a, b) => a.lineY - b.lineY);
  for (let i = 1; i < pills.length; i++) {
    const min = pills[i - 1].y + h + 2;
    if (pills[i].y < min) pills[i].y = min;
  }
  // Pushed past the bottom: shift the stack back up, then keep it below the top.
  for (let i = pills.length - 1; i >= 0; i--) {
    const max = (i === pills.length - 1 ? o.height : pills[i + 1].y - 2) - h;
    if (pills[i].y > max) pills[i].y = max;
  }
  for (let i = 0; i < pills.length; i++) {
    const min = i === 0 ? 0 : pills[i - 1].y + h + 2;
    if (pills[i].y < min) pills[i].y = min;
  }
  return pills;
}

/** The part of a line under (x, y): a label's button first, then the label, then a draggable line. */
export function hitPills(pills: readonly Pill[], lines: readonly TradeLine[], ys: readonly (number | null)[], x: number, y: number, coarse: boolean): LineHit | null {
  const grow = coarse ? 8 : 2;
  for (const p of pills) {
    if (y < p.y - grow || y > p.y + p.h + grow || x < p.x || x > p.x + p.w) continue;
    for (const t of p.tabs) if (x >= t.x && x <= t.x + t.w) return { line: p.line, part: { tab: t.key } };
    if (y >= p.y && y <= p.y + p.h) return { line: p.line, part: "label" };
  }
  const tol = coarse ? 14 : 6;
  let best: TradeLine | null = null, dist = tol;
  lines.forEach((l, i) => {
    const ly = ys[i];
    if (!l.draggable || l.bare || ly === null || ly === undefined) return;
    const d = Math.abs(ly - y);
    if (d <= dist) { dist = d; best = l; }
  });
  return best ? { line: best, part: "line" } : null;
}

/**
 * Open positions and pending orders as lines across the chart, MT5-style: the
 * entry, the stop, the target and each order's price, each with a label at
 * the right end carrying its buttons (set a stop, set a target, breakeven,
 * close). Also the ask line and the countdown to the candle's close. Painted
 * by the chart itself, so they move with every zoom and pan; the same boxes
 * that are painted are the ones a click is tested against.
 */
export class TradeLines implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private lines: TradeLine[] = [];
  private ys: (number | null)[] = [];
  private pills: Pill[] = [];
  private hover: { id: string; tab: TabKey | null } | null = null;
  private countdown: { price: number; text: string } | null = null;
  private countdownY: number | null = null;
  private views: IPrimitivePaneView[];
  private axis: ISeriesPrimitiveAxisView[] = [];
  private readonly countdownView: ISeriesPrimitiveAxisView;
  private widths = new Map<string, number>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly font: string, private readonly decimals: number, readonly coarse = false) {
    this.views = [{ zOrder: () => "top", renderer: () => ({ draw: (t) => this.draw(t) }) }];
    this.countdownView = {
      coordinate: () => this.countdownY ?? -100,
      text: () => this.countdown?.text ?? "",
      textColor: () => "#ffffff",
      backColor: () => "rgba(80, 84, 96, 0.92)",
      visible: () => this.countdown !== null && this.countdownY !== null,
      tickVisible: () => false,
    };
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart as IChartApi; this.series = series; this.requestUpdate = requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }

  set(lines: TradeLine[]) {
    this.lines = lines;
    this.axis = lines.map((l, i) => ({
      coordinate: () => this.ys[i] ?? -100,
      text: () => l.price.toFixed(this.decimals),
      textColor: () => "#ffffff",
      backColor: () => l.color,
      visible: () => !!l.axis && this.ys[i] !== null && this.ys[i] !== undefined,
    }));
    this.requestUpdate?.();
  }

  /** Time left on the candle, shown on the axis under the price. */
  setCountdown(c: { price: number; text: string } | null) {
    this.countdown = c;
    this.requestUpdate?.();
  }

  setHover(h: { id: string; tab: TabKey | null } | null) {
    if (h?.id === this.hover?.id && h?.tab === this.hover?.tab) return;
    this.hover = h;
    this.requestUpdate?.();
  }

  get all(): readonly TradeLine[] { return this.lines; }

  /** What is under (x, y), pane pixels. */
  hitAt(x: number, y: number): LineHit | null {
    return hitPills(this.pills, this.lines, this.ys, x, y, this.coarse);
  }

  /** Where a line's label is (pane pixels), for placing an editor next to it. */
  pillOf(id: string): Pill | null { return this.pills.find((p) => p.line.id === id) ?? null; }

  /** The chart's own cursor over a label's buttons and over a line that can be dragged. */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hitAt(x, y);
    if (!h) return null;
    const onTab = typeof h.part === "object";
    const movable = h.line.draggable || h.line.role === "entry";
    return {
      cursorStyle: onTab ? "pointer" : movable ? "ns-resize" : "default",
      externalId: h.line.id, zOrder: "top", hitTestPriority: onTab ? 2 : 1,
    };
  }

  updateAllViews() {
    const s = this.series;
    const size = this.chart?.paneSize(0);
    const h = size?.height ?? Infinity;
    // Off the top or bottom of the chart is null: no line, and no axis label
    // pinned to the edge as if the price were on screen.
    this.ys = this.lines.map((l) => {
      const y = s ? s.priceToCoordinate(l.price) : null;
      return y === null || y < 0 || y > h ? null : y;
    });
    const cy = this.countdown && s ? s.priceToCoordinate(this.countdown.price) : null;
    this.countdownY = cy === null ? null : cy + 15;
    this.pills = size ? layoutPills(this.lines, this.ys, { width: size.width, height: size.height, coarse: this.coarse, measure: (t) => this.measure(t) }) : [];
  }

  paneViews() { return this.views; }
  priceAxisViews() { return this.countdown ? [...this.axis, this.countdownView] : this.axis; }

  private measure(text: string): number {
    let w = this.widths.get(text);
    if (w !== undefined) return w;
    if (!this.measureCtx) {
      this.measureCtx = document.createElement("canvas").getContext("2d");
      if (this.measureCtx) this.measureCtx.font = `600 11px ${this.font}`;
    }
    w = this.measureCtx ? this.measureCtx.measureText(text).width : text.length * 6.5;
    if (this.widths.size > 500) this.widths.clear();
    this.widths.set(text, w);
    return w;
  }

  private draw(target: Target) {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      // The lines, full width.
      this.lines.forEach((l, i) => {
        const yc = this.ys[i];
        if (yc === null || yc === undefined) return;
        const y = Math.round(yc * vr) + 0.5;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash(l.dotted ? [Math.round(1 * hr), Math.round(3 * hr)] : l.dashed ? [Math.round(5 * hr), Math.round(4 * hr)] : []);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bitmapSize.width, y); ctx.stroke();
      });
      ctx.setLineDash([]);
      // The labels, with their buttons.
      ctx.font = `600 ${Math.round(11 * vr)}px ${this.font}`;
      ctx.textBaseline = "middle";
      for (const p of this.pills) {
        const x = p.x * hr, y = p.y * vr, w = p.w * hr, h = p.h * vr, mid = y + h / 2;
        if (Math.abs(p.y + p.h / 2 - p.lineY) > 1) {
          // Moved off its line: a short connector back to the level.
          ctx.strokeStyle = p.line.color;
          ctx.lineWidth = Math.max(1, Math.round(vr));
          ctx.beginPath(); ctx.moveTo(x - 10 * hr, Math.round(p.lineY * vr) + 0.5); ctx.lineTo(x, mid); ctx.stroke();
        }
        ctx.fillStyle = p.line.color;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 * hr); ctx.fill();
        const hovered = this.hover?.id === p.line.id;
        if (hovered && this.hover?.tab === null) {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 * hr); ctx.fill();
        }
        if (p.grip) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          for (let k = -1; k <= 1; k++) ctx.fillRect(x + 3 * hr, mid + k * 3 * vr - 0.5 * vr, 4 * hr, 1 * vr);
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(p.line.label, p.labelX * hr, mid + 0.5 * vr);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 * hr); ctx.clip();
        for (const t of p.tabs) {
          const tx = t.x * hr, tw = t.w * hr;
          ctx.fillStyle = hovered && this.hover?.tab === t.key ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.16)";
          ctx.fillRect(tx, y, tw, h);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(tx, y + 2 * vr, Math.max(1, Math.round(hr)), h - 4 * vr);
          ctx.fillStyle = "#ffffff";
          const tw2 = ctx.measureText(t.text).width;
          ctx.fillText(t.text, tx + (tw - tw2) / 2, mid + 0.5 * vr);
        }
        ctx.restore();
      }
      ctx.restore();
    });
  }
}
