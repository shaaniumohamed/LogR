"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { BarSeries } from "@/lib/core/market/format";
import type { Timeframe } from "@/lib/core/market/bars";
import type { Candle } from "@/lib/core/replay/forming";
import type { IndicatorSpec } from "@/lib/core/backtest";
import { BarFeed } from "@/lib/market/feed";
import { createChartHandle, type ChartHandle } from "@/lib/chart/handle";
import { IndicatorTrack } from "@/lib/chart/indicator-track";
import { ChartLegend } from "@/components/chart/chart-legend";

const DAY = 86_400;
/** Load more when fewer than this many candles — or two screens' worth — are left beyond either edge. */
const EDGE = 120;
/** Stored candles a replay chart starts with; more appear as it is scrolled left. */
const REPLAY_WINDOW = 4000;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** `#rrggbb` at an opacity, as the chart's own colour parser understands it. */
function withAlpha(colour: string, alpha: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : colour;
}

function candlesOf(s: BarSeries | null): Candle[] {
  if (!s) return [];
  const k = 10 ** s.decimals;
  const out: Candle[] = new Array(s.count);
  for (let i = 0; i < s.count; i++) {
    out[i] = { time: s.time[i], open: s.open[i] / k, high: s.high[i] / k, low: s.low[i] / k, close: s.close[i] / k, volume: s.volume[i] };
  }
  return out;
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

/** Hands the replay a way to put its live candles on the chart (null when the chart goes). */
export type LivePush = (closed: Candle[], forming: Candle | null) => void;

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
 * For replay, `until` stops the stored history at a moment, and the replay
 * pushes the candles after it — closed ones and the one forming — through the
 * function it is given by `onLive`. Indicators follow every push.
 *
 * The chart is handed out through `onReady` for the drawing kit, the same way
 * the journal's trade chart does.
 */
export function MarketChart({
  symbol, tf, timeZone, decimals, goTo, height = 420, fill = false, onReady, onStatus,
  until, onLive, type = "candles", volume: showVolume = true, indicators, markers,
}: {
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
  /** Stored history ends here (epoch seconds, exclusive); the replay supplies the rest. */
  until?: number;
  onLive?: (push: LivePush | null) => void;
  type?: "candles" | "line";
  volume?: boolean;
  indicators?: IndicatorSpec[];
  markers?: SeriesMarker<Time>[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<{ chart: IChartApi; main: ISeriesApi<SeriesType>; volume: ISeriesApi<"Histogram"> | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState<"first" | "older" | "newer" | null>("first");
  const feedRef = useRef<BarFeed | null>(null);
  /** Every candle drawn except the forming one: stored history, then live closed candles. */
  const rows = useRef<Candle[]>([]);
  /** The replay's candles; `drawn` and `first` say how far its list had got, as it grows the same list in place. */
  const live = useRef<{ closed: Candle[]; forming: Candle | null; drawn: number; first: number | null }>({ closed: [], forming: null, drawn: 0, first: null });
  const tracks = useRef<{ track: IndicatorTrack; series: ISeriesApi<"Line"> }[]>([]);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const centre = useRef<number | null>(null);
  // Bumped by "Reset view" when the latest candles are not loaded: reopen at the end.
  const [toLatest, setToLatest] = useState(0);
  const latestSeen = useRef(0);
  const lastLegendBump = useRef(0);
  const legendTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(legendTimer.current), []);
  /** The timeframe the current feed was opened for: a replay reopening on the same one keeps the view. */
  const openedFor = useRef<string | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
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
    const priceFormat = { type: "price" as const, precision: decimals, minMove: Number(`1e-${decimals}`) };
    const main: ISeriesApi<SeriesType> = type === "line"
      ? chart.addSeries(LineSeries, { color: cssVar("--c1", "#2566c4"), lineWidth: 2, priceFormat })
      : chart.addSeries(CandlestickSeries, {
          upColor: colours.current.up, downColor: colours.current.down, borderVisible: false,
          wickUpColor: colours.current.up, wickDownColor: colours.current.down, priceFormat,
        });
    // Tick volume in its own pane under the price, as on MT5 and TradingView.
    let volume: ISeriesApi<"Histogram"> | null = null;
    if (showVolume) {
      volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
      chart.panes()[1]?.setHeight(76);
    }
    const { handle, dispose } = createChartHandle(chart, main, el);
    setApi({ chart, main, volume });
    onReadyRef.current?.(handle);
    return () => {
      dispose();
      onReadyRef.current?.(null);
      markersApi.current = null;
      tracks.current = [];
      chart.remove();
      setApi(null);
    };
  }, [decimals, type, showVolume]);

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
      // main series' own priceFormat sets its decimals.
      localization: { timeFormatter: (t: Time) => (dateOnly ? fullDate : full).format(d(t)) },
    });
  }, [api, timeZone, dateOnly]);

  /* -------------------------------------------------------------- data */

  const point = useCallback((c: Candle) => (type === "line"
    ? { time: c.time as UTCTimestamp, value: c.close }
    : { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }), [type]);
  const volPoint = useCallback((c: Candle) => ({
    time: c.time as UTCTimestamp, value: c.volume,
    color: withAlpha(c.close >= c.open ? colours.current.up : colours.current.down, 0.45),
  }), []);

  /** Indicator lines over `rows`, then the forming candle. */
  const drawIndicators = useCallback(() => {
    const forming = live.current.forming;
    for (const { track, series } of tracks.current) {
      const values = track.reset(rows.current);
      series.setData(rows.current.map((c, i) => (values[i] === null ? { time: c.time as UTCTimestamp } : { time: c.time as UTCTimestamp, value: values[i]! })));
      if (forming && forming.time > (rows.current.at(-1)?.time ?? -Infinity)) {
        const v = track.peek(forming);
        if (v !== null) series.update({ time: forming.time as UTCTimestamp, value: v });
      }
    }
  }, []);

  const draw = useCallback((bars: BarSeries | null, keep: "view" | "none") => {
    if (!api) return;
    const ts = api.chart.timeScale();
    const before = keep === "view" ? ts.getVisibleLogicalRange() : null;
    const old = rows.current;
    const refIdx = before && old.length ? Math.min(old.length - 1, Math.max(0, Math.round(before.from))) : -1;
    const refTime = refIdx >= 0 ? old[refIdx].time : null;

    const history = candlesOf(bars);
    const lastHistory = history.length ? history[history.length - 1].time : -Infinity;
    rows.current = history.concat(live.current.closed.filter((c) => c.time > lastHistory));
    api.main.setData(rows.current.map(point));
    api.volume?.setData(rows.current.map(volPoint));
    const f = live.current.forming;
    if (f && f.time > (rows.current.at(-1)?.time ?? -Infinity)) {
      api.main.update(point(f));
      api.volume?.update(volPoint(f));
    }
    drawIndicators();

    // Keep the same candle under the same pixel, whatever was added or dropped.
    if (before && refTime !== null && rows.current.length) {
      const idx = lowerBound(rows.current, refTime);
      const from = idx - (refIdx - before.from);
      ts.setVisibleLogicalRange({ from, to: from + (before.to - before.from) });
    }
    setVersion((v) => v + 1);
  }, [api, point, volPoint, drawIndicators]);

  /** The replay's candles after the stored history: append what is new, redraw the forming one. */
  const push = useCallback<LivePush>((closed, forming) => {
    if (!api) return;
    const { drawn, first } = live.current;
    const restart = closed.length < drawn || (drawn > 0 && closed.length > 0 && closed[0].time !== first);
    live.current = { closed, forming, drawn: closed.length, first: closed[0]?.time ?? null };
    if (restart) { draw(feedRef.current?.bars ?? null, "view"); return; }
    for (let i = drawn; i < closed.length; i++) {
      const c = closed[i];
      const last = rows.current.at(-1)?.time ?? -Infinity;
      if (c.time < last) continue;
      if (c.time === last) rows.current[rows.current.length - 1] = c; else rows.current.push(c);
      api.main.update(point(c));
      api.volume?.update(volPoint(c));
      for (const { track, series } of tracks.current) {
        const v = track.push(c);
        series.update(v === null ? { time: c.time as UTCTimestamp } : { time: c.time as UTCTimestamp, value: v });
      }
    }
    if (forming && forming.time > (rows.current.at(-1)?.time ?? -Infinity)) {
      api.main.update(point(forming));
      api.volume?.update(volPoint(forming));
      for (const { track, series } of tracks.current) {
        const v = track.peek(forming);
        if (v !== null) series.update({ time: forming.time as UTCTimestamp, value: v });
      }
    }
    // The readout follows the latest candle, a few times a second at most —
    // and once more after the last push, so it ends on the candle drawn.
    const now = performance.now();
    window.clearTimeout(legendTimer.current);
    if (now - lastLegendBump.current > 200) { lastLegendBump.current = now; setVersion((v) => v + 1); }
    else legendTimer.current = window.setTimeout(() => { lastLegendBump.current = performance.now(); setVersion((v) => v + 1); }, 200);
  }, [api, draw, point, volPoint]);

  // Indicator lines: rebuilt when the list changes, drawn from the rows already held.
  const indicatorKey = JSON.stringify(indicators ?? []);
  useEffect(() => {
    if (!api) return;
    for (const t of tracks.current) api.chart.removeSeries(t.series);
    tracks.current = (indicators ?? []).map((spec) => ({
      track: new IndicatorTrack(spec),
      series: api.chart.addSeries(LineSeries, {
        color: spec.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        title: spec.kind === "vwap" ? "VWAP" : `${spec.kind.toUpperCase()} ${spec.period}`,
      }),
    }));
    drawIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, indicatorKey, drawIndicators]);

  // Markers: fills and news. The plugin re-reads the whole series after every
  // new candle, so it is only attached while there is something to show.
  useEffect(() => {
    if (!api) return;
    const list = [...(markers ?? [])].sort((a, b) => (a.time as number) - (b.time as number));
    if (!list.length) { markersApi.current?.detach(); markersApi.current = null; return; }
    if (markersApi.current) markersApi.current.setMarkers(list);
    else markersApi.current = createSeriesMarkers(api.main, list);
  }, [api, markers]);

  /** The default view: a comfortable candle width, the latest candles, or `at` in the middle. */
  const frame = useCallback((at: number | null) => {
    if (!api) return;
    const ts = api.chart.timeScale();
    // About 45 candles across a phone, 110–150 across a laptop, as TradingView opens.
    const phone = (wrap.current?.clientWidth ?? 800) < 520;
    const spacing = phone ? 5 : 8;
    ts.applyOptions({ barSpacing: spacing, rightOffset: phone ? 4 : 8 });
    api.chart.priceScale("right").applyOptions({ autoScale: true });
    if (at === null || !rows.current.length) { ts.scrollToRealTime(); return; }
    const width = Math.max(100, (wrap.current?.clientWidth ?? 800) - api.chart.priceScale("right").width());
    const visible = width / spacing;
    const idx = Math.min(rows.current.length - 1, lowerBound(rows.current, at));
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

  // A new symbol, timeframe, replay moment or "go to": open a feed around the right moment.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const latest = toLatest > latestSeen.current;
    latestSeen.current = toLatest;
    const replay = until !== undefined;
    const at = latest || replay ? undefined : goTo?.time ?? centre.current ?? undefined;
    const t0 = performance.now();
    setLoading("first");
    live.current = { closed: [], forming: null, drawn: 0, first: null };
    const keepView = replay && openedFor.current === `${symbol}|${tf.key}` && rows.current.length > 0;
    // A replay holds a window of recent candles, wide enough to keep what is on screen.
    const shownFrom = keepView ? Math.floor(api.chart.timeScale().getVisibleLogicalRange()?.from ?? 0) : rows.current.length;
    const held = replay ? Math.max(REPLAY_WINDOW, rows.current.length - shownFrom + EDGE * 4) : undefined;
    BarFeed.open(symbol, tf, { anchor: replay ? until : at, until, window: held }).then((feed) => {
      if (!alive) return;
      feedRef.current = feed;
      openedFor.current = `${symbol}|${tf.key}`;
      if (keepView) {
        // The replay folded its live candles into the stored history: same
        // timeframe, same zoom, same candles under the same pixels.
        draw(feed.bars, "view");
        onLiveRef.current?.(push);
      } else {
        rows.current = [];
        draw(feed.bars, "none");
        // The replay puts its candles on as soon as it can push them.
        onLiveRef.current?.(push);
        frame(at ?? null);
      }
      setLoading(null);
      report(t0);
    }).catch((e) => {
      if (!alive) return;
      setLoading(null);
      report(t0, e instanceof Error ? e.message : "Could not load the price history.");
    });
    return () => { alive = false; onLiveRef.current?.(null); };
    // `goTo` is compared by identity on purpose: picking the same day twice re-centres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, symbol, tf, goTo, toLatest, until]);

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
      const feed = feedRef.current;
      const all = rows.current;
      if (!r || !feed || !all.length) return;
      const mid = Math.min(all.length - 1, Math.max(0, Math.round((r.from + r.to) / 2)));
      centre.current = all[mid].time;
      if (busy) return;
      const info = api.main.barsInLogicalRange(r);
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
      {api && <ChartLegend chart={api.chart} candles={api.main} volume={api.volume} title={title} decimals={decimals} version={version} />}
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

function lowerBound(rows: Candle[], t: number): number {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].time < t) lo = mid + 1; else hi = mid; }
  return lo;
}
