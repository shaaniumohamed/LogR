"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { aggregate, type Candle } from "@/lib/core/parse-candles";
import { HIGHER_TIMEFRAMES, higherTimeframe, MINUTE_TIMEFRAMES } from "@/lib/core/timeframes";
import { priceDecimals } from "@/lib/core/instrument";
import { createChartHandle, type ChartHandle } from "@/lib/chart/handle";
import { PriceBand } from "@/lib/chart/price-band";

export interface Fill {
  kind: "in" | "out";
  /** Epoch seconds, UTC. */
  time: number;
  price: number;
  lots: number;
  profit: number;
}

const DAY = 86_400;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * The trade on real candles, at whatever timeframe the idea came from.
 *
 * Two sources behind one row of buttons, because they answer different halves
 * of the same question. The minute timeframes are rolled up in the browser from
 * the one-minute bars already on the page, so switching between them is free
 * and shows exactly the window that was loaded. The higher ones are their own
 * stored series and reach months or years, because the reason for a trade is
 * usually further left than any intraday window can see — a level read on the
 * daily and executed on the three minute cannot be reviewed on the three minute.
 *
 * Switching to a higher timeframe re-centres rather than showing everything
 * loaded: a daily chart of thirteen years with one entry on it is not a review.
 *
 * The chart draws nothing the trader made. It hands itself out through
 * `onReady`, and the drawing kit (components/chart/drawing-system.tsx) attaches
 * to it; `onTimeframe` says which timeframe is showing, for drawings that are
 * set to appear only on some.
 */
export function CandleChart({
  bars, htf = {}, fills, timeZone, symbol, onReady, onTimeframe,
  zoneFromFills, invalidation, tradeFrom, tradeTo, height = 320, fill = false,
}: {
  bars: Candle[];
  /** Stored higher-timeframe series, keyed by interval. */
  htf?: Record<string, Candle[]>;
  fills: Fill[];
  timeZone: string;
  symbol: string;
  /** The chart, once it exists; null just before it is removed. */
  onReady?: (handle: ChartHandle | null) => void;
  /** The timeframe on screen: "m1", "m5", … for minutes, "1h", "4h", "1day", "1week" above. */
  onTimeframe?: (key: string) => void;
  /** The band the ladder actually filled into. Always shown; not a drawing. */
  zoneFromFills: { low: number; high: number };
  invalidation: number | null;
  /** The trade's own span, in epoch seconds, for centring the higher timeframes. */
  tradeFrom: number;
  tradeTo: number;
  height?: number;
  /** Take the height of the container instead of `height` — the full-screen view. */
  fill?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Held across renders: both are plugins attached to the series, so re-creating
  // them on every timeframe change would stack duplicate layers on the chart
  // rather than replace them.
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const bandRef = useRef<PriceBand | null>(null);
  const [sel, setSel] = useState<string>(() => `m${pickMinuteTimeframe(bars.length)}`);

  const decimals = useMemo(() => priceDecimals(symbol), [symbol]);

  // A button that yields four candles is a button that wastes a tap. Twelve is
  // about where a chart stops being a chart.
  const minuteOffered = useMemo(
    () => MINUTE_TIMEFRAMES.filter((t) => t.key === 1 || bars.length / t.key >= 12),
    [bars.length],
  );
  const higherOffered = useMemo(
    () => HIGHER_TIMEFRAMES.filter((t) => (htf[t.key]?.length ?? 0) >= 12),
    [htf],
  );

  const view = useMemo(() => {
    const tf = sel.startsWith("m") ? null : higherTimeframe(sel);
    if (tf) {
      return {
        kind: "htf" as const, tf,
        data: htf[tf.key] ?? [],
        bucket: tf.seconds,
        dateOnly: tf.seconds >= DAY,
      };
    }
    const minutes = Number(sel.slice(1)) || 1;
    return {
      kind: "min" as const, tf: null,
      data: aggregate(bars, minutes),
      bucket: minutes * 60,
      dateOnly: false,
    };
  }, [sel, bars, htf]);

  // A selection can stop being offered when the data behind it changes.
  useEffect(() => {
    const ok = sel.startsWith("m")
      ? minuteOffered.some((t) => `m${t.key}` === sel)
      : higherOffered.some((t) => t.key === sel);
    if (!ok && minuteOffered.length) setSel(`m${minuteOffered[0].key}`);
  }, [sel, minuteOffered, higherOffered]);

  const fmtTime = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }), [timeZone]);
  const fmtDate = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", timeZone,
  }), [timeZone]);
  const fmtFull = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }), [timeZone]);
  const fmtFullDate = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone,
  }), [timeZone]);

  const fillRef = useRef(fill);
  fillRef.current = fill;
  const zoneRef = useRef(zoneFromFills);
  zoneRef.current = zoneFromFills;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onTimeframeRef = useRef(onTimeframe);
  onTimeframeRef.current = onTimeframe;
  useEffect(() => { onTimeframeRef.current?.(sel); }, [sel]);

  /* Create the chart once. Data, markers and colours are applied separately so a
     timeframe change or a theme change never tears the chart down and back up. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--ink3", "#898781"),
        fontFamily: cssVar("--font-mono", "monospace"),
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar("--line", "rgba(0,0,0,.08)") },
        horzLines: { color: cssVar("--line", "rgba(0,0,0,.08)") },
      },
      rightPriceScale: { borderColor: cssVar("--line", "rgba(0,0,0,.08)"), scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: cssVar("--line", "rgba(0,0,0,.08)"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      // Dragging the price axis stretches it, as on TradingView — a fib drawn to
      // an extreme needs the extreme on screen. Double-click the axis to reset.
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--profit", "#1baf7a"),
      downColor: cssVar("--loss", "#e34948"),
      borderVisible: false,
      wickUpColor: cssVar("--profit", "#1baf7a"),
      wickDownColor: cssVar("--loss", "#e34948"),
      priceFormat: { type: "price", precision: decimals, minMove: Number(`1e-${decimals}`) },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const band = new PriceBand(zoneRef.current.low, zoneRef.current.high, {
      colour: cssVar("--c1", "#2566c4"),
      labelBack: cssVar("--s1", "#fcfcfb"),
      font: cssVar("--font-mono", "monospace"),
      label: "WHERE YOU FILLED",
    });
    series.attachPrimitive(band);
    bandRef.current = band;

    const ro = new ResizeObserver(() => {
      chart.applyOptions(fillRef.current
        ? { width: el.clientWidth, height: el.clientHeight }
        : { width: el.clientWidth });
    });
    ro.observe(el);

    const { handle, dispose } = createChartHandle(chart, series, el);
    onReadyRef.current?.(handle);

    return () => {
      ro.disconnect();
      // Whatever is attached comes off while the chart still exists.
      dispose();
      onReadyRef.current?.(null);
      chart.remove();
      chartRef.current = null; seriesRef.current = null;
      markersRef.current = null; priceLineRef.current = null; bandRef.current = null;
    };
    // Height is applied below rather than here: tearing the chart down to change
    // it would lose the zoom and scroll every time the full-screen view toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decimals]);

  useEffect(() => {
    const chart = chartRef.current, el = wrapRef.current;
    if (!chart || !el) return;
    chart.applyOptions({ height: fill ? el.clientHeight : height });
  }, [fill, height]);

  // The band the ladder filled into: always shown, never editable, not a drawing.
  useEffect(() => { bandRef.current?.set(zoneFromFills.low, zoneFromFills.high); }, [zoneFromFills.low, zoneFromFills.high]);

  /* Axis wording follows the timeframe: a weekly chart labelled by the hour is
     unreadable, and an intraday one labelled by the day is useless. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // The app has one clock — the trader's — and the chart has to use it too, or
    // an hour-of-day finding elsewhere will not match what is on screen.
    chart.applyOptions({
      timeScale: {
        timeVisible: !view.dateOnly,
        // Where a new day starts, say which day: an hourly chart that labels two
        // midnights "08:00" gives no way to tell Monday from Tuesday.
        tickMarkFormatter: (t: Time, type: TickMarkType) =>
          (view.dateOnly || type <= TickMarkType.DayOfMonth ? fmtDate : fmtTime).format(new Date((t as number) * 1000)),
      },
      localization: {
        timeFormatter: (t: Time) =>
          (view.dateOnly ? fmtFullDate : fmtFull).format(new Date((t as number) * 1000)),
        priceFormatter: (p: number) => p.toFixed(decimals),
      },
    });
  }, [view.dateOnly, fmtDate, fmtTime, fmtFull, fmtFullDate, decimals]);

  /* Data and markers. */
  useEffect(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || !view.data.length) return;

    series.setData(view.data.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    // A price axis stretched by hand on one timeframe would hide the candles of
    // the next, so each new set of candles starts fitted again.
    chart.priceScale("right").applyOptions({ autoScale: true });

    /*
     * Snapped to the bar each fill fell in, because a marker between two bars is
     * dropped silently — which would quietly hide exits at coarser timeframes.
     *
     * Then collapsed to one marker per bar per direction. A ladder of twenty
     * fills inside a single weekly candle is twenty glyphs stacked on the same
     * pixel: unreadable, and it hides the price band they actually covered. One
     * marker at the mean of that bar's fills says the true thing legibly.
     */
    const grouped = new Map<string, { time: number; kind: "in" | "out"; sum: number; n: number; profit: number }>();
    for (const f of fills) {
      const t = Math.floor(f.time / view.bucket) * view.bucket;
      const key = `${t}:${f.kind}`;
      const g = grouped.get(key) ?? { time: t, kind: f.kind, sum: 0, n: 0, profit: 0 };
      g.sum += f.price; g.n += 1; g.profit += f.profit;
      grouped.set(key, g);
    }
    const markers: SeriesMarker<Time>[] = [...grouped.values()]
      .map((g) => ({
        time: g.time as UTCTimestamp,
        position: "atPriceMiddle" as const,
        price: g.sum / g.n,
        shape: g.kind === "in" ? ("arrowUp" as const) : ("circle" as const),
        color: g.kind === "in" ? cssVar("--c1", "#2a78d6")
             : g.profit >= 0 ? cssVar("--profit", "#1baf7a") : cssVar("--loss", "#e34948"),
        size: g.kind === "in" ? 1.4 : 1,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (markersRef.current) markersRef.current.setMarkers(markers);
    else markersRef.current = createSeriesMarkers(series, markers);

    if (priceLineRef.current) { series.removePriceLine(priceLineRef.current); priceLineRef.current = null; }
    if (invalidation !== null) {
      priceLineRef.current = series.createPriceLine({
        price: invalidation,
        color: cssVar("--loss", "#e34948"),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "idea dead",
      });
    }

    if (view.kind === "htf") {
      // Centred on the trade rather than fitted to everything stored: thirteen
      // years of daily candles with one entry somewhere in them is not a review.
      const from = Math.max(view.data[0].time, tradeFrom - view.tf.viewBefore * DAY);
      const to = Math.min(view.data[view.data.length - 1].time + view.bucket, tradeTo + view.tf.viewAfter * DAY);
      if (to > from) chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
      else chart.timeScale().fitContent();
    } else {
      chart.timeScale().fitContent();
    }
  }, [view, fills, invalidation, tradeFrom, tradeTo]);

  const Button = ({ id, label }: { id: string; label: string }) => (
    <button type="button" onClick={() => setSel(id)} aria-pressed={sel === id}
            className="!px-2.5 !py-1 !text-[12px]">
      {label}
    </button>
  );

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : undefined}>
      {/*
        Wrapped onto a second line rather than scrolled sideways.
        Ten buttons do not fit across a phone, and in a scrolling strip the four
        that fall off the right are the higher timeframes — which is to say, the
        ones nothing else on the page can show and which nobody would think to
        go looking for. A row that is one line taller is a cheap price for the
        daily and the weekly being visible at all.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Two groups, because they are two different things: the minute family
            is rolled up from the bars on screen, the higher one is its own
            stored series reaching months back. Each group fits a phone on its
            own line, so neither can fall off the edge. */}
        <div className="seg" role="group" aria-label="Minute timeframes">
          {minuteOffered.map((t) => <Button key={t.key} id={`m${t.key}`} label={t.label} />)}
        </div>
        {higherOffered.length > 0 && (
          <div className="seg" role="group" aria-label="Higher timeframes">
            {higherOffered.map((t) => <Button key={t.key} id={t.key} label={t.label} />)}
          </div>
        )}
        <span className="price ml-auto text-[11px]" style={{ color: "var(--ink3)" }}>{symbol}</span>
      </div>

      <div className={`relative ${fill ? "min-h-0 flex-1" : ""}`}>
        {/* isolate: the chart layers its canvases with z-indexes of its own,
            which must stay below the page's sheets and menus. */}
        <div ref={wrapRef} className={fill ? "absolute inset-0 isolate overflow-hidden" : "isolate w-full"} />
      </div>
    </div>
  );
}

/**
 * Open at a timeframe that fits the window on screen.
 *
 * About 200 bars is what reads well on a phone: fewer and the chart is mostly
 * empty, more and the candles are thinner than a finger. A five-minute scalp
 * therefore opens at one minute and a long hold opens coarser, without the
 * trader having to set anything.
 */
function pickMinuteTimeframe(barCount: number): number {
  const target = 200;
  for (const tf of [1, 5, 15, 30]) if (barCount / tf <= target * 1.5) return tf;
  return 30;
}
