import type { DataChangedScope, ISeriesApi, SeriesType } from "lightweight-charts";
import type { OHLC } from "lightweight-charts-drawing";

type Item = { time: OHLC["time"]; open?: number; high?: number; low?: number; close?: number; value?: number; volume?: number };

const toBar = (d: Item): OHLC => {
  const v = d.value ?? d.close ?? 0;
  return { time: d.time, open: d.open ?? v, high: d.high ?? v, low: d.low ?? v, close: d.close ?? v, volume: d.volume };
};

/**
 * A series' candles in the shape the drawing kit asks for, kept up to date as
 * the chart changes rather than rebuilt on every call.
 *
 * The kit asks for them whenever a drawing has a point off the candles (in the
 * empty space to the right, or between candles of another timeframe): several
 * times per drawing on every repaint. Its default rebuilds the whole list from
 * the chart each time; with thousands of candles and a replay adding new ones
 * twenty times a second, that was most of the page's work. Here the list is
 * rebuilt only when the chart's data is replaced; an update re-reads just the
 * newest candles.
 */
export function seriesBars(series: ISeriesApi<SeriesType>): { bars: () => OHLC[]; dispose: () => void } {
  let list: OHLC[] = [];
  let dirty: DataChangedScope | null = "full";
  const onChange = (scope: DataChangedScope) => { if (dirty !== "full") dirty = scope; };
  series.subscribeDataChanged(onChange);

  const bars = () => {
    if (dirty === "update") {
      // An update changes the last candle or adds candles after it. The list
      // lines up with the chart's own index only if the last one still matches.
      const n = list.length;
      const last = n ? (series.dataByIndex(n - 1) as Item | null) : null;
      if (n && last && last.time === list[n - 1].time) {
        for (let i = n - 1; ; i++) {
          const d = series.dataByIndex(i) as Item | null;
          if (!d) break;
          list[i] = toBar(d);
        }
      } else dirty = "full";
    }
    if (dirty === "full") list = (series.data() as Item[]).map(toBar);
    dirty = null;
    return list;
  };
  return { bars, dispose: () => series.unsubscribeDataChanged(onChange) };
}
