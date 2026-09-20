"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { aggregate, type Candle } from "@/lib/core/parse-candles";
import { HIGHER_TIMEFRAMES, higherTimeframe, MINUTE_TIMEFRAMES } from "@/lib/core/timeframes";
import { priceDecimals } from "@/lib/core/instrument";
import type { Drawing } from "@/lib/core/types";

export interface Fill {
  kind: "in" | "out";
  /** Epoch seconds, UTC. */
  time: number;
  price: number;
  lots: number;
  profit: number;
}

export type DrawMode = null | "level" | "zone";

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
 * Zones are drawn as HTML bands over the canvas rather than as chart objects.
 * A horizontal price band spans the whole chart by definition, so it needs only
 * a top and a height, and keeping it in the DOM means it can carry a real text
 * label and be styled with the same tokens as everything else on the page.
 */
export function CandleChart({
  bars, htf = {}, fills, timeZone, symbol, drawings, drawMode, onPick,
  zoneFromFills, invalidation, tradeFrom, tradeTo, height = 320,
}: {
  bars: Candle[];
  /** Stored higher-timeframe series, keyed by interval. */
  htf?: Record<string, Candle[]>;
  fills: Fill[];
  timeZone: string;
  symbol: string;
  drawings: Drawing[];
  drawMode: DrawMode;
  /** Called with the price the trader tapped, when a drawing mode is active. */
  onPick?: (price: number) => void;
  /** The band the ladder actually filled into. Always shown; not a drawing. */
  zoneFromFills: { low: number; high: number };
  invalidation: number | null;
  /** The trade's own span, in epoch seconds, for centring the higher timeframes. */
  tradeFrom: number;
  tradeTo: number;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Held across renders: both are plugins attached to the series, so re-creating
  // them on every timeframe change would stack duplicate layers on the chart
  // rather than replace them.
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const [sel, setSel] = useState<string>(() => `m${pickMinuteTimeframe(bars.length)}`);
  // Y positions of every band, in CSS pixels, recomputed whenever the scale moves.
  const [geom, setGeom] = useState<{ rightPad: number; y: (p: number) => number | null } | null>(null);

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
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
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

    // Coalesced to one measurement a frame: a pan fires the range callback on
    // every pointer move, and re-rendering React that often to reposition a
    // couple of bands is exactly the kind of thing that feels bad on a phone.
    let queued = 0;
    const measure = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        const s = seriesRef.current, c = chartRef.current;
        if (!s || !c) return;
        setGeom({ rightPad: c.priceScale("right").width(), y: (p: number) => s.priceToCoordinate(p) });
      });
    };
    // The bands follow the price scale, which moves on zoom, pan, autoscale and
    // resize. Those are exactly the events below; nothing polls.
    chart.timeScale().subscribeVisibleLogicalRangeChange(measure);
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: el.clientWidth }); measure(); });
    ro.observe(el);

    return () => {
      if (queued) cancelAnimationFrame(queued);
      ro.disconnect();
      chart.remove();
      chartRef.current = null; seriesRef.current = null;
      markersRef.current = null; priceLineRef.current = null;
    };
  }, [height, decimals]);

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
        tickMarkFormatter: (t: Time) =>
          (view.dateOnly ? fmtDate : fmtTime).format(new Date((t as number) * 1000)),
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

    setGeom({
      rightPad: chart.priceScale("right").width(),
      y: (p: number) => series.priceToCoordinate(p),
    });
  }, [view, fills, invalidation, tradeFrom, tradeTo]);

  /* Tapping the chart while a drawing mode is active reports the price tapped. */
  useEffect(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || !drawMode || !onPick) return;
    const handler = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) onPick(Number(price));
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [drawMode, onPick]);

  const bands = useMemo(() => {
    if (!geom) return [];
    const list: { key: string; low: number; high: number; label: string; color: string; dashed: boolean }[] = [
      {
        key: "filled", low: zoneFromFills.low, high: zoneFromFills.high,
        label: "where you filled", color: cssVar("--c1", "#2a78d6"), dashed: false,
      },
      ...drawings.map((d) => ({
        key: d.id, low: d.low, high: d.high, label: d.label,
        color: cssVar("--c2", "#eda100"), dashed: true,
      })),
    ];
    return list.flatMap((b) => {
      const yTop = geom.y(Math.max(b.low, b.high));
      const yBot = geom.y(Math.min(b.low, b.high));
      if (yTop === null || yBot === null) return [];
      return [{ ...b, top: yTop, height: Math.max(2, yBot - yTop) }];
    });
  }, [geom, drawings, zoneFromFills]);

  const Button = ({ id, label }: { id: string; label: string }) => (
    <button type="button" onClick={() => setSel(id)}
      className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold"
      style={sel === id
        ? { background: "var(--ink)", color: "var(--plane)" }
        : { color: "var(--ink3)", border: "1px solid var(--line)" }}>
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1">
          {minuteOffered.map((t) => <Button key={t.key} id={`m${t.key}`} label={t.label} />)}
          {higherOffered.length > 0 && (
            <span className="shrink-0 self-center px-0.5" style={{ color: "var(--line)" }}>|</span>
          )}
          {higherOffered.map((t) => <Button key={t.key} id={t.key} label={t.label} />)}
        </div>
        <span className="num shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{symbol}</span>
      </div>

      <div className="relative" style={{ cursor: drawMode ? "crosshair" : undefined }}>
        <div ref={wrapRef} className="w-full" />
        {bands.map((b) => (
          <div key={b.key} className="pointer-events-none absolute left-0"
               style={{
                 top: b.top, height: b.height, right: geom ? geom.rightPad : 0,
                 background: `color-mix(in srgb, ${b.color} 14%, transparent)`,
                 borderTop: `1px ${b.dashed ? "dashed" : "solid"} ${b.color}`,
                 borderBottom: `1px ${b.dashed ? "dashed" : "solid"} ${b.color}`,
               }}>
            <span className="absolute left-1 top-0.5 text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: b.color }}>{b.label}</span>
          </div>
        ))}
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
