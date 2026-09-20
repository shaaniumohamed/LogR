"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { aggregate, type Candle } from "@/lib/core/parse-candles";
import type { Drawing } from "@/lib/core/types";

export interface Fill {
  kind: "in" | "out";
  /** Epoch seconds, UTC. */
  time: number;
  price: number;
  lots: number;
  profit: number;
}

/**
 * Coarser timeframes are rolled up in the browser, so switching costs no round trip.
 *
 * The odd ones are here because they are the ones actually looked at. A journal
 * that offers 1, 5, 15 and 60 because those are the conventional buttons is
 * showing a chart the trader does not read; if the entry was found on the three
 * minute, the review has to be able to show the three minute.
 *
 * Daily and weekly are deliberately absent: a review window is hours to a few
 * days, and a daily candle over it is one candle. Those belong on the
 * annotation, as a record of where the idea came from, not here as a zoom.
 */
const TIMEFRAMES = [
  { key: 1, label: "1m" }, { key: 3, label: "3m" }, { key: 5, label: "5m" },
  { key: 10, label: "10m" }, { key: 15, label: "15m" }, { key: 30, label: "30m" },
  { key: 60, label: "1h" },
] as const;

export type DrawMode = null | "level" | "zone";

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * The trade on real candles.
 *
 * Candles are stored only at one minute and rolled up here, so the timeframe
 * buttons redraw instantly instead of going back to the server — which matters
 * because comparing what the entry looked like on 1m against what the level
 * looked like on 15m is the actual work of reviewing a level trade.
 *
 * Zones are drawn as HTML bands over the canvas rather than as chart objects.
 * A horizontal price band spans the whole chart by definition, so it needs only
 * a top and a height, and keeping it in the DOM means it can carry a real text
 * label and be styled with the same tokens as everything else on the page.
 */
export function CandleChart({
  bars, fills, timeZone, symbol, drawings, drawMode, onPick, zoneFromFills, invalidation, height = 320,
}: {
  bars: Candle[];
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
  const [tf, setTf] = useState<number>(() => pickTimeframe(bars.length));
  // Y positions of every band, in CSS pixels, recomputed whenever the scale moves.
  const [geom, setGeom] = useState<{ rightPad: number; y: (p: number) => number | null } | null>(null);

  const shown = useMemo(() => aggregate(bars, tf), [bars, tf]);

  // A button that yields four candles is a button that wastes a tap. Twelve is
  // about where a chart stops being a chart.
  const offered = useMemo(
    () => TIMEFRAMES.filter((t) => t.key === 1 || bars.length / t.key >= 12),
    [bars.length],
  );

  const fmtTime = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }), [timeZone]);
  const fmtFull = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
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
      timeScale: {
        borderColor: cssVar("--line", "rgba(0,0,0,.08)"),
        timeVisible: true,
        secondsVisible: false,
        // The app has one clock — the trader's — and the chart has to use it too,
        // or an hour-of-day finding elsewhere will not match what is on screen.
        tickMarkFormatter: (t: Time) => fmtTime.format(new Date((t as number) * 1000)),
      },
      localization: {
        timeFormatter: (t: Time) => fmtFull.format(new Date((t as number) * 1000)),
        priceFormatter: (p: number) => p.toFixed(2),
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--profit", "#1baf7a"),
      downColor: cssVar("--loss", "#e34948"),
      borderVisible: false,
      wickUpColor: cssVar("--profit", "#1baf7a"),
      wickDownColor: cssVar("--loss", "#e34948"),
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
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
  }, [height, fmtTime, fmtFull]);

  /* Data and markers. */
  useEffect(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || !shown.length) return;

    series.setData(shown.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    // Snapped to the bar each fill fell in, because a marker between two bars is
    // dropped silently — which would quietly hide exits at coarser timeframes.
    const bucket = tf * 60;
    const markers: SeriesMarker<Time>[] = fills.map((f) => ({
      time: (Math.floor(f.time / bucket) * bucket) as UTCTimestamp,
      position: "atPriceMiddle" as const,
      price: f.price,
      shape: f.kind === "in" ? ("arrowUp" as const) : ("circle" as const),
      color: f.kind === "in" ? cssVar("--c1", "#2a78d6")
           : f.profit >= 0 ? cssVar("--profit", "#1baf7a") : cssVar("--loss", "#e34948"),
      size: f.kind === "in" ? 1.4 : 1,
    })).sort((a, b) => (a.time as number) - (b.time as number));

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

    chart.timeScale().fitContent();
    setGeom({
      rightPad: chart.priceScale("right").width(),
      y: (p: number) => series.priceToCoordinate(p),
    });
  }, [shown, fills, tf, invalidation]);

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

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {offered.map((t) => (
            <button key={t.key} type="button" onClick={() => setTf(t.key)}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
              style={tf === t.key
                ? { background: "var(--ink)", color: "var(--plane)" }
                : { color: "var(--ink3)", border: "1px solid var(--line)" }}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="num text-[11px]" style={{ color: "var(--ink3)" }}>{symbol}</span>
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
function pickTimeframe(barCount: number): number {
  const target = 200;
  for (const tf of [1, 5, 15, 60]) if (barCount / tf <= target * 1.5) return tf;
  return 60;
}
