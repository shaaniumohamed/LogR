"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, TickMarkType, createChart,
  type IChartApi, type ISeriesApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { BarSeries } from "@/lib/core/market/format";
import type { Timeframe } from "@/lib/core/market/bars";
import { BarFeed } from "@/lib/market/feed";
import { createChartHandle, type ChartHandle } from "@/lib/chart/handle";
import { ChartLegend } from "@/components/chart/chart-legend";

const DAY = 86_400;
/** Load more when fewer than this many candles — or two screens' worth — are left beyond either edge. */
const EDGE = 120;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** `#rrggbb` at an opacity, as the chart's own colour parser understands it. */
function withAlpha(colour: string, alpha: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : colour;
}

export interface MarketChartStatus {
  candles: number;
  span: [string, string] | null;
  files: number;
  fromCache: number;
  bytes: number;
  ms: number;
  error?: string;
}

/**
 * The stored price history on a chart that behaves like TradingView's.
 *
 *  - Scroll left or right and more history loads, all the way back to the
 *    first file held; the view never jumps when it arrives.
 *  - It opens on the latest candles at a comfortable candle width, or centred
 *    on `goTo` when that is set; changing timeframe keeps the moment that was
 *    in the middle of the screen.
 *  - The crosshair moves freely, and the line at the top left reads out the
 *    open, high, low, close and volume of the candle under it.
 *  - Times are in the trader's zone. Candles still open and close on UTC (the
 *    broker's MT5 server time), so a daily candle matches MT5.
 *
 * The chart is handed out through `onReady` for the drawing kit, the same way
 * the journal's trade chart does.
 */
export function MarketChart({ symbol, tf, timeZone, decimals, goTo, height = 420, fill = false, onReady, onStatus }: {
  symbol: string;
  tf: Timeframe;
  timeZone: string;
  /** Price decimals to show. */
  decimals: number;
  /** Centre on this moment (epoch seconds). A new object re-centres, even on the same time. */
  goTo?: { time: number } | null;
  height?: number;
  /** Take the container's height instead of `height`. */
  fill?: boolean;
  onReady?: (handle: ChartHandle | null) => void;
  onStatus?: (s: MarketChartStatus) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<{ chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState<"first" | "older" | "newer" | null>("first");
  const feedRef = useRef<BarFeed | null>(null);
  const shown = useRef<BarSeries | null>(null);
  const centre = useRef<number | null>(null);
  // Bumped by "Reset view" when the latest candles are not loaded: reopen at the end.
  const [toLatest, setToLatest] = useState(0);
  const latestSeen = useRef(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const colours = useRef({ up: "#1baf7a", down: "#e34948" });

  /* ------------------------------------------------------------ create */

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const line = cssVar("--line", "rgba(0,0,0,.08)");
    colours.current = { up: cssVar("--profit", "#1baf7a"), down: cssVar("--loss", "#e34948") };
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--ink3", "#888"), fontSize: 10, attributionLogo: false,
        fontFamily: cssVar("--font-mono", "monospace"),
        panes: { separatorColor: line, separatorHoverColor: line },
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      // Free crosshair: it sits where the pointer is, not snapped to the close.
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 8, minBarSpacing: 0.5 },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: colours.current.up, downColor: colours.current.down, borderVisible: false,
      wickUpColor: colours.current.up, wickDownColor: colours.current.down,
      priceFormat: { type: "price", precision: decimals, minMove: Number(`1e-${decimals}`) },
    });
    // Tick volume in its own pane under the price, as on MT5 and TradingView.
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false,
    }, 1);
    chart.panes()[1]?.setHeight(76);
    const { handle, dispose } = createChartHandle(chart, candles, el);
    setApi({ chart, candles, volume });
    onReadyRef.current?.(handle);
    return () => {
      dispose();
      onReadyRef.current?.(null);
      chart.remove();
      setApi(null);
    };
  }, [decimals]);

  /* ------------------------------------------------- time in the trader's zone */

  const dateOnly = tf.seconds >= DAY;
  useEffect(() => {
    if (!api) return;
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone });
    const time = f({ hour: "2-digit", minute: "2-digit", hour12: false });
    const day = f({ day: "numeric", month: "short" });
    const month = f({ month: "short" });
    const year = f({ year: "numeric" });
    const full = f({ weekday: "short", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    const fullDate = f({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const d = (t: Time) => new Date((t as number) * 1000);
    api.chart.applyOptions({
      timeScale: {
        timeVisible: !dateOnly,
        tickMarkFormatter: (t: Time, type: TickMarkType) =>
          type === TickMarkType.Year ? year.format(d(t))
            : type === TickMarkType.Month ? month.format(d(t))
            : type === TickMarkType.DayOfMonth || dateOnly ? day.format(d(t))
            : time.format(d(t)),
      },
      // No price formatter here: it would apply to the volume axis too. The
      // candles' own priceFormat sets their decimals.
      localization: { timeFormatter: (t: Time) => (dateOnly ? fullDate : full).format(d(t)) },
    });
  }, [api, timeZone, dateOnly]);

  /* -------------------------------------------------------------- data */

  const draw = useCallback((bars: BarSeries | null, keep: "view" | "none") => {
    if (!api) return;
    const ts = api.chart.timeScale();
    const before = keep === "view" ? ts.getVisibleLogicalRange() : null;
    const old = shown.current;
    const refIdx = before && old && old.count ? Math.min(old.count - 1, Math.max(0, Math.round(before.from))) : -1;
    const refTime = refIdx >= 0 && old ? old.time[refIdx] : null;

    const k = bars ? 10 ** bars.decimals : 1;
    const n = bars?.count ?? 0;
    const cs = new Array(n), vs = new Array(n);
    const upV = withAlpha(colours.current.up, 0.45);
    const downV = withAlpha(colours.current.down, 0.45);
    for (let i = 0; i < n; i++) {
      const t = bars!.time[i] as UTCTimestamp, o = bars!.open[i] / k, c = bars!.close[i] / k;
      cs[i] = { time: t, open: o, high: bars!.high[i] / k, low: bars!.low[i] / k, close: c };
      vs[i] = { time: t, value: bars!.volume[i], color: c >= o ? upV : downV };
    }
    api.candles.setData(cs);
    api.volume.setData(vs);
    shown.current = bars;

    // Keep the same candle under the same pixel, whatever was added or dropped.
    if (before && refTime !== null && bars) {
      const idx = feedRef.current?.indexAt(refTime) ?? 0;
      const from = idx - (refIdx - before.from);
      ts.setVisibleLogicalRange({ from, to: from + (before.to - before.from) });
    }
    setVersion((v) => v + 1);
  }, [api]);

  /** The default view: a comfortable candle width, the latest candles, or `at` in the middle. */
  const frame = useCallback((at: number | null) => {
    if (!api) return;
    const ts = api.chart.timeScale();
    // About 45 candles across a phone, 110–150 across a laptop, as TradingView opens.
    const phone = (wrap.current?.clientWidth ?? 800) < 520;
    const spacing = phone ? 5 : 8;
    ts.applyOptions({ barSpacing: spacing, rightOffset: phone ? 4 : 8 });
    api.chart.priceScale("right").applyOptions({ autoScale: true });
    const feed = feedRef.current, bars = shown.current;
    if (at === null || !feed || !bars) { ts.scrollToRealTime(); return; }
    const width = Math.max(100, (wrap.current?.clientWidth ?? 800) - api.chart.priceScale("right").width());
    const visible = width / spacing;
    const idx = Math.min(bars.count - 1, feed.indexAt(at));
    ts.setVisibleLogicalRange({ from: idx - visible * 0.6, to: idx + visible * 0.4 });
  }, [api]);

  const report = useCallback((t0: number, error?: string) => {
    const f = feedRef.current;
    onStatusRef.current?.({
      candles: f?.bars?.count ?? 0, span: f?.span ?? null,
      files: f?.stats.files ?? 0, fromCache: f?.stats.fromCache ?? 0, bytes: f?.stats.bytes ?? 0,
      ms: Math.round(performance.now() - t0), error,
    });
  }, []);

  // A new symbol, timeframe or "go to": open a feed around the right moment.
  useEffect(() => {
    if (!api) return;
    let live = true;
    const latest = toLatest > latestSeen.current;
    latestSeen.current = toLatest;
    const at = latest ? undefined : goTo?.time ?? centre.current ?? undefined;
    const t0 = performance.now();
    setLoading("first");
    BarFeed.open(symbol, tf, { anchor: at }).then((feed) => {
      if (!live) return;
      feedRef.current = feed;
      shown.current = null;
      draw(feed.bars, "none");
      frame(at ?? null);
      setLoading(null);
      report(t0);
    }).catch((e) => {
      if (!live) return;
      setLoading(null);
      report(t0, e instanceof Error ? e.message : "Could not load the price history.");
    });
    return () => { live = false; };
    // `goTo` is compared by identity on purpose: picking the same day twice re-centres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, symbol, tf, goTo, toLatest]);

  /** Back to the newest candles at the default zoom, loading them if need be. */
  const reset = useCallback(() => {
    if (feedRef.current?.hasNewer) { centre.current = null; setToLatest((n) => n + 1); }
    else frame(null);
  }, [frame]);

  // More history as the chart nears either end; remember the middle for timeframe changes.
  useEffect(() => {
    if (!api) return;
    let busy = false;
    const onRange = () => {
      const r = api.chart.timeScale().getVisibleLogicalRange();
      const bars = shown.current, feed = feedRef.current;
      if (!r || !bars || !feed || !bars.count) return;
      const mid = Math.min(bars.count - 1, Math.max(0, Math.round((r.from + r.to) / 2)));
      centre.current = bars.time[mid];
      if (busy) return;
      const info = api.candles.barsInLogicalRange(r);
      if (!info) return;
      const edge = Math.max(EDGE, 2 * (r.to - r.from));
      const side = info.barsBefore < edge && feed.hasOlder ? "older" : info.barsAfter < edge && feed.hasNewer ? "newer" : null;
      if (!side) return;
      busy = true;
      setLoading(side);
      const t0 = performance.now();
      (side === "older" ? feed.older() : feed.newer()).then((changed) => {
        if (changed && feedRef.current === feed) draw(feed.bars, "view");
        report(t0);
      }).catch((e) => report(t0, e instanceof Error ? e.message : "Could not load more history."))
        .finally(() => { busy = false; setLoading(null); });
    };
    api.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => api.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, [api, draw, report]);

  const title = useMemo(() => `${symbol} · ${tf.label}`, [symbol, tf.label]);

  return (
    <div className={`relative ${fill ? "h-full min-h-0" : ""}`}>
      <div ref={wrap} className={`isolate w-full ${fill ? "absolute inset-0" : ""}`} style={fill ? undefined : { height }} />
      {api && <ChartLegend chart={api.chart} candles={api.candles} volume={api.volume} title={title} decimals={decimals} version={version} />}
      {loading && (
        <div className="pointer-events-none absolute top-8 z-[5] rounded-full px-2.5 py-1 text-[11px] font-medium"
             style={{ [loading === "newer" ? "right" : "left"]: 8, background: "var(--s1)", color: "var(--ink2)", boxShadow: "0 1px 6px rgb(0 0 0 / 0.15)" }}>
          {loading === "first" ? "Loading price history…" : loading === "older" ? "Loading earlier history…" : "Loading later history…"}
        </div>
      )}
      <button type="button" onClick={reset} title="Back to the latest candles, default zoom"
              className="absolute bottom-8 right-[68px] z-[6] rounded-md px-2.5 py-1.5 text-[11px] font-medium leading-none"
              style={{ background: "color-mix(in srgb, var(--s1) 85%, transparent)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
        Reset view
      </button>
    </div>
  );
}
