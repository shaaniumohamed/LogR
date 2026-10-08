import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive,
  SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";
import { SESSIONS, sessionWindows } from "@/lib/core/replay/clock";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const COLOURS: Record<string, string> = { tokyo: "171, 71, 188", london: "41, 98, 255", newyork: "255, 152, 0" };

interface Box { x1: number; x2: number; y1: number; y2: number; label: string; rgb: string }

/**
 * Tokyo, London and New York as boxes around each session's high and low, as
 * session indicators draw them on TradingView. Worked out from the candles on
 * screen each time the chart repaints, so they follow the replay as it plays;
 * only drawn on timeframes of an hour or less, where a session is several
 * candles wide.
 */
export class SessionBoxes implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private boxes: Box[] = [];
  private enabled = true;
  private barSeconds = 300;
  private requestUpdate: (() => void) | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor(private readonly font: string) {
    this.views = [{ zOrder: () => "bottom", renderer: () => ({ draw: (t) => this.draw(t) }) }];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart as IChartApi; this.series = series; this.requestUpdate = requestUpdate;
  }
  detached() { this.chart = null; this.series = null; this.requestUpdate = null; }

  configure(enabled: boolean, barSeconds: number) {
    this.enabled = enabled; this.barSeconds = barSeconds;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.boxes = [];
    const chart = this.chart, series = this.series;
    if (!chart || !series || !this.enabled || this.barSeconds > 3600) return;
    const ts = chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const from = Math.max(0, Math.floor(r.from)), to = Math.ceil(r.to);
    const bars: { time: number; high: number; low: number }[] = [];
    for (let i = from; i <= to; i++) {
      const d = series.dataByIndex(i) as { time?: number; high?: number; low?: number; value?: number } | null;
      if (!d || d.time === undefined) continue;
      const hi = d.high ?? d.value, lo = d.low ?? d.value;
      if (hi === undefined || lo === undefined) continue;
      bars.push({ time: d.time, high: hi, low: lo });
    }
    if (bars.length < 2) return;
    const half = (ts.options().barSpacing ?? 6) / 2;
    for (const s of SESSIONS) {
      for (const w of sessionWindows(s, bars[0].time, bars[bars.length - 1].time + this.barSeconds)) {
        let hi = -Infinity, lo = Infinity, first: number | null = null, last: number | null = null;
        for (const b of bars) {
          if (b.time < w.start || b.time >= w.end) continue;
          if (b.high > hi) hi = b.high;
          if (b.low < lo) lo = b.low;
          first ??= b.time;
          last = b.time;
        }
        if (first === null || last === null) continue;
        const x1 = ts.timeToCoordinate(first as Time), x2 = ts.timeToCoordinate(last as Time);
        const y1 = series.priceToCoordinate(hi), y2 = series.priceToCoordinate(lo);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        this.boxes.push({ x1: x1 - half, x2: x2 + half, y1, y2, label: s.label, rgb: COLOURS[s.id] });
      }
    }
  }

  paneViews() { return this.views; }

  private draw(target: Target) {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.font = `600 ${Math.round(10 * vr)}px ${this.font}`;
      ctx.textBaseline = "bottom";
      for (const b of this.boxes) {
        const x = Math.round(b.x1 * hr), y = Math.round(b.y1 * vr);
        const w = Math.round((b.x2 - b.x1) * hr), h = Math.max(1, Math.round((b.y2 - b.y1) * vr));
        ctx.fillStyle = `rgba(${b.rgb}, 0.07)`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = `rgba(${b.rgb}, 0.45)`;
        ctx.lineWidth = Math.max(1, Math.round(hr));
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = `rgba(${b.rgb}, 0.9)`;
        ctx.fillText(b.label, x + 3 * hr, y - 2 * vr);
      }
      ctx.restore();
    });
  }
}
