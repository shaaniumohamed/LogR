import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";

/**
 * A chart handed from the component that owns it to the things that draw on it.
 *
 * `onDispose` exists because of ordering. Anything attached to the chart (the
 * drawing kit, the touch layer) has to come off while the chart still exists:
 * the kit's teardown touches the chart, and if it throws halfway it leaves its
 * keyboard listeners behind on the window. React gives no promise about which
 * of two sibling components cleans up first, so the owner calls these, then
 * removes the chart.
 */
export interface ChartHandle {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  /** The element the chart was created in; the touch layer listens here. */
  host: HTMLElement;
  /** Run `fn` just before the chart is removed. Returns an unsubscribe. */
  onDispose(fn: () => void): () => void;
}

/** A handle for a chart the caller owns; call `dispose` before `chart.remove()`. */
export function createChartHandle(chart: IChartApi, series: ISeriesApi<SeriesType>, host: HTMLElement) {
  const fns = new Set<() => void>();
  const handle: ChartHandle = {
    chart, series, host,
    onDispose(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
  };
  const dispose = () => {
    for (const fn of [...fns]) {
      try { fn(); } catch (e) { console.error(e); }
    }
    fns.clear();
  };
  return { handle, dispose };
}
