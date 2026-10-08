import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitivePaneViewZOrder,
  SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface PriceBandStyle {
  colour: string;
  /** Behind the label, so it stays legible over candles. */
  labelBack: string;
  font: string;
  label: string;
}

/**
 * A full-width band between two prices, painted by the chart itself.
 *
 * Used for the range a ladder filled into. It is not a drawing — nobody drew
 * it, and it cannot be moved — so it lives outside the drawing kit. Being part
 * of the chart's own paint means it follows every zoom, pan and price-axis drag
 * in the same frame, with nothing measuring the scale from outside. The fill
 * sits behind the candles; the label sits on top, so candles never cover it.
 */
export class PriceBand implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private top: number | null = null;
  private bottom: number | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor(private low: number, private high: number, private style: PriceBandStyle) {
    const view = (z: PrimitivePaneViewZOrder, draw: (t: Target) => void): IPrimitivePaneView => ({
      zOrder: () => z,
      renderer: () => ({ draw }),
    });
    this.views = [view("bottom", (t) => this.drawBand(t)), view("top", (t) => this.drawLabel(t))];
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  set(low: number, high: number) {
    this.low = low;
    this.high = high;
    this.requestUpdate?.();
  }

  updateAllViews() {
    const s = this.series;
    if (!s) return;
    this.top = s.priceToCoordinate(Math.max(this.low, this.high));
    this.bottom = s.priceToCoordinate(Math.min(this.low, this.high));
  }

  paneViews() {
    return this.views;
  }

  /** The band in bitmap pixels, at least two device-independent pixels tall. */
  private rows(vr: number) {
    if (this.top === null || this.bottom === null) return null;
    const top = Math.round(this.top * vr);
    const height = Math.max(Math.round(2 * vr), Math.round(this.bottom * vr) - top);
    return { top, height };
  }

  private drawBand(target: Target) {
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, verticalPixelRatio: vr }) => {
      const r = this.rows(vr);
      if (!r) return;
      ctx.save();
      ctx.fillStyle = this.style.colour;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(0, r.top, bitmapSize.width, r.height);
      ctx.globalAlpha = 1;
      const line = Math.max(1, Math.round(vr));
      ctx.fillRect(0, r.top, bitmapSize.width, line);
      ctx.fillRect(0, r.top + r.height - line, bitmapSize.width, line);
      ctx.restore();
    });
  }

  private drawLabel(target: Target) {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const r = this.rows(vr);
      if (!r) return;
      ctx.save();
      // Under the band rather than inside it: the trader's own name for a zone
      // at the same price sits inside, top-left, and the two would collide.
      ctx.font = `700 ${Math.round(9 * vr)}px ${this.style.font}`;
      const text = this.style.label;
      const w = ctx.measureText(text).width + 8 * hr;
      const h = Math.round(13 * vr);
      const x = Math.round(4 * hr), y = r.top + r.height + Math.round(1 * vr);
      ctx.fillStyle = this.style.labelBack;
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3 * hr);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.style.colour;
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 4 * hr, y + h / 2 + 0.5 * vr);
      ctx.restore();
    });
  }
}
