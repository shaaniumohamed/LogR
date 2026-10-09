import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** One leg of a finished trade: candle times (already on the chart's timeframe) and prices. */
export interface TradePath { id: string; t0: number; p0: number; t1: number; p1: number; win: boolean }

/**
 * A dotted line from each finished trade's entry to its exit, as TradingView
 * draws executions: green for a winner, red for a loser. Only the trades on
 * screen are worked out each repaint (they are kept sorted by entry), so a
 * session with hundreds of trades costs no more than one with a few.
 */
export class TradePaths implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private paths: TradePath[] = [];
  private longest = 0;
  private visible: { x0: number; y0: number; x1: number; y1: number; win: boolean; hot: boolean }[] = [];
  private hot: { id: string; until: number } | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor(private readonly colours: { win: string; loss: string }) {
    this.views = [{ zOrder: () => "normal", renderer: () => ({ draw: (t) => this.draw(t) }) }];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart as IChartApi; this.series = series; this.requestUpdate = requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }

  set(paths: TradePath[]) {
    this.paths = [...paths].sort((a, b) => a.t0 - b.t0);
    this.longest = this.paths.reduce((m, p) => Math.max(m, p.t1 - p.t0), 0);
    this.requestUpdate?.();
  }

  /** Make one trade stand out for a moment (after clicking it in the history). */
  highlight(id: string, ms = 2000) {
    this.hot = { id, until: performance.now() + ms };
    this.requestUpdate?.();
    window.setTimeout(() => this.requestUpdate?.(), ms + 20);
  }

  updateAllViews() {
    this.visible = [];
    const chart = this.chart, series = this.series;
    if (!chart || !series || !this.paths.length) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleRange();
    if (!range) return;
    const from = (range.from as number) - this.longest, to = range.to as number;
    let lo = 0, hi = this.paths.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.paths[mid].t0 < from) lo = mid + 1; else hi = mid; }
    const hotId = this.hot && this.hot.until > performance.now() ? this.hot.id : null;
    for (let i = lo; i < this.paths.length && this.paths[i].t0 <= to; i++) {
      const p = this.paths[i];
      const x0 = ts.timeToCoordinate(p.t0 as Time), x1 = ts.timeToCoordinate(p.t1 as Time);
      const y0 = series.priceToCoordinate(p.p0), y1 = series.priceToCoordinate(p.p1);
      if (x0 === null || x1 === null || y0 === null || y1 === null) continue;
      this.visible.push({ x0, y0, x1, y1, win: p.win, hot: p.id === hotId });
    }
  }

  paneViews() { return this.views; }

  private draw(target: Target) {
    if (!this.visible.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      for (const v of this.visible) {
        ctx.strokeStyle = v.win ? this.colours.win : this.colours.loss;
        ctx.lineWidth = Math.max(1, Math.round((v.hot ? 2.5 : 1) * hr));
        ctx.setLineDash(v.hot ? [] : [Math.round(2 * hr), Math.round(3 * hr)]);
        ctx.beginPath(); ctx.moveTo(v.x0 * hr, v.y0 * vr); ctx.lineTo(v.x1 * hr, v.y1 * vr); ctx.stroke();
      }
      ctx.restore();
    });
  }
}
