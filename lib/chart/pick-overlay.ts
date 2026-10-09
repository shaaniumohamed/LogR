import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  SeriesAttachedParameter, Time,
} from "lightweight-charts";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/**
 * "Replay from here": a vertical line at the candle the replay would start
 * on, with everything after it dimmed — the part that disappears once the
 * start is picked — and the candle's date and time on the time axis.
 */
export class PickOverlay implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private x: number | null = null;
  private label = "";
  private readonly views: IPrimitivePaneView[];
  private readonly timeView: ISeriesPrimitiveAxisView;

  constructor(private readonly dim: string, private readonly accent: string, private readonly coarse = false) {
    this.views = [{ zOrder: () => "top", renderer: () => ({ draw: (t) => this.draw(t) }) }];
    this.timeView = {
      coordinate: () => this.x ?? -100,
      text: () => this.label,
      textColor: () => "#ffffff",
      backColor: () => this.accent,
      visible: () => this.x !== null,
      tickVisible: () => true,
    };
  }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>) { this.chart = chart as IChartApi; this.requestUpdate = requestUpdate; }
  detached() { this.chart = null; this.requestUpdate = null; }

  set(x: number | null, label: string) {
    if (x === this.x && label === this.label) return;
    this.x = x; this.label = label;
    this.requestUpdate?.();
  }

  get position() { return this.x; }

  paneViews() { return this.views; }
  timeAxisViews() { return [this.timeView]; }

  private draw(target: Target) {
    const x = this.x;
    if (x === null || !this.chart) return;
    const half = (this.chart.timeScale().options().barSpacing ?? 6) / 2;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const px = Math.round(x * hr);
      ctx.fillStyle = this.dim;
      const from = Math.round((x + half) * hr);
      ctx.fillRect(from, 0, Math.max(0, bitmapSize.width - from), bitmapSize.height);
      ctx.fillStyle = this.accent;
      ctx.fillRect(px - Math.floor(hr / 2), 0, Math.max(1, Math.round(hr)), bitmapSize.height);
      // A handle to grab with a finger.
      const r = (this.coarse ? 11 : 7) * hr;
      const cy = bitmapSize.height - (this.coarse ? 24 : 16) * vr;
      ctx.beginPath(); ctx.arc(px, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      for (const dx of [-3, 0, 3]) ctx.fillRect(px + dx * hr - 0.5 * hr, cy - 4 * vr, Math.max(1, hr), 8 * vr);
    });
  }
}
