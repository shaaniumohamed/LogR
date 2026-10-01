"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi,
  type MouseEventParams, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { aggregate, type Candle } from "@/lib/core/parse-candles";
import { HIGHER_TIMEFRAMES, higherTimeframe, MINUTE_TIMEFRAMES } from "@/lib/core/timeframes";
import { priceDecimals } from "@/lib/core/instrument";
import type { Drawing } from "@/lib/core/types";
import { indexToTime, magnet, timeToIndex } from "@/lib/core/drawings";
import { DrawingLayer, type Geom, type NewDrawing, type Tool } from "@/components/chart-drawings";

export interface Fill {
  kind: "in" | "out";
  /** Epoch seconds, UTC. */
  time: number;
  price: number;
  lots: number;
  profit: number;
}

export type { NewDrawing, Tool } from "@/components/chart-drawings";

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
 * Mark-up is drawn in a layer over the canvas rather than as chart objects
 * (see chart-drawings.tsx). Keeping it in the DOM means it can carry real text,
 * be tapped and dragged like anything else on the page, and be styled with the
 * same tokens — so a theme change recolours drawings along with everything else.
 */
export function CandleChart({
  bars, htf = {}, fills, timeZone, symbol, drawings, tool = null, onCreate, onDraft, selected = null, onSelect, onMove,
  zoneFromFills, invalidation, tradeFrom, tradeTo, height = 320, fill = false,
}: {
  bars: Candle[];
  /** Stored higher-timeframe series, keyed by interval. */
  htf?: Record<string, Candle[]>;
  fills: Fill[];
  timeZone: string;
  symbol: string;
  drawings: Drawing[];
  /** The drawing tool in hand, if any. Taps on the chart place it. */
  tool?: Tool | null;
  onCreate?: (d: NewDrawing) => void;
  /** Whether the first tap of a two-tap drawing is down, so the hint can move on. */
  onDraft?: (placed: boolean) => void;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** A drawing was dragged to a new place. Called once, when the finger lifts. */
  onMove?: (d: Drawing) => void;
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
  const [sel, setSel] = useState<string>(() => `m${pickMinuteTimeframe(bars.length)}`);
  // Where prices and times sit on screen, recomputed whenever the scale moves.
  const [geom, setGeom] = useState<Geom | null>(null);
  // The first tap of a two-tap drawing, and where the pointer is now, for the preview.
  const [draft, setDraft] = useState<{ t: number; p: number } | null>(null);
  const [hover, setHover] = useState<{ t: number; p: number } | null>(null);

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

  const times = useMemo(() => view.data.map((c) => c.time), [view]);
  // Read by callbacks the chart holds on to, which would otherwise see the view
  // as it was when they were subscribed.
  const viewRef = useRef({ view, times });
  viewRef.current = { view, times };

  /*
   * Screen geometry for the drawing layer.
   *
   * The library only converts whole candle indexes to pixels (a fractional one
   * comes back as zero), so the layout is read off two neighbouring candles and
   * extended linearly — the time axis is evenly spaced by index, so that is
   * exact, and it works for times beyond either end of the loaded candles.
   */
  const buildGeom = useCallback((): Geom | null => {
    const c = chartRef.current, s = seriesRef.current;
    const { view: v, times: ts } = viewRef.current;
    if (!c || !s || !ts.length) return null;
    const ts0 = c.timeScale();
    const x0 = ts0.logicalToCoordinate(0 as never);
    const x1 = ts0.logicalToCoordinate(1 as never);
    if (x0 === null || x1 === null) return null;
    const spacing = x1 - x0 || 1;
    const idx = (x: number) => (x - x0) / spacing;
    const pane = c.paneSize(0);
    return {
      rightPad: c.priceScale("right").width(),
      paneW: pane.width,
      paneH: pane.height,
      spacing,
      x: (t: number) => x0 + timeToIndex(ts, v.bucket, t) * spacing,
      y: (p: number) => s.priceToCoordinate(p),
      idx,
      price: (y: number) => { const p = s.coordinateToPrice(y); return p === null ? null : Number(p); },
      time: (i: number) => indexToTime(ts, v.bucket, i),
      tIdx: (t: number) => timeToIndex(ts, v.bucket, t),
      bar: (i: number) => v.data[Math.round(i)],
    };
  }, []);

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
        setGeom(buildGeom());
      });
    };
    // The bands follow the price scale, which moves on zoom, pan, autoscale and
    // resize. Those are exactly the events below; nothing polls.
    chart.timeScale().subscribeVisibleLogicalRangeChange(measure);
    const ro = new ResizeObserver(() => {
      chart.applyOptions(fillRef.current
        ? { width: el.clientWidth, height: el.clientHeight }
        : { width: el.clientWidth });
      measure();
    });
    ro.observe(el);

    return () => {
      if (queued) cancelAnimationFrame(queued);
      ro.disconnect();
      chart.remove();
      chartRef.current = null; seriesRef.current = null;
      markersRef.current = null; priceLineRef.current = null;
    };
    // Height is applied below rather than here: tearing the chart down to change
    // it would lose the zoom and scroll every time the full-screen view toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decimals]);

  useEffect(() => {
    const chart = chartRef.current, el = wrapRef.current;
    if (!chart || !el) return;
    chart.applyOptions({ height: fill ? el.clientHeight : height });
    requestAnimationFrame(() => setGeom(buildGeom()));
  }, [fill, height, buildGeom]);

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

    setGeom(buildGeom());
  }, [view, fills, invalidation, tradeFrom, tradeTo, buildGeom]);

  /*
   * A tap on the chart, in candle and price.
   *
   * The time is the open of the candle tapped, never a point between candles,
   * so a note always belongs to a candle; the price is pulled onto that
   * candle's open, high, low or close when it lands within a fingertip of one.
   */
  const pointAt = useCallback((x: number, y: number) => {
    const g = buildGeom();
    if (!g) return null;
    const i = Math.round(g.idx(x));
    const raw = g.price(y);
    if (raw === null) return null;
    return { t: g.time(i), p: magnet(raw, g.bar(i), g.y) };
  }, [buildGeom]);

  // A different tool, or none, abandons a half-placed drawing.
  useEffect(() => { setDraft(null); setHover(null); }, [tool]);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => { onDraftRef.current?.(draft !== null); }, [draft]);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const handlers = useRef({ onCreate, onSelect });
  handlers.current = { onCreate, onSelect };

  /*
   * Taps are read off the page's own pointer events, not the chart's click
   * callback. The chart holds back a second click that comes within half a
   * second of the first while it waits to see whether it is a double-click —
   * which silently ate the second corner of a box tapped at a natural pace.
   * Listening alongside the chart rather than instead of it leaves panning and
   * zooming exactly as they were: a press that moves is a pan, not a tap.
   */
  const tapAt = useCallback((x: number, y: number) => {
    const t = toolRef.current;
    // Without a tool in hand, a tap on empty chart puts down whatever was selected.
    if (!t) { handlers.current.onSelect?.(null); return; }
    const at = pointAt(x, y);
    if (!at) return;
    const create = handlers.current.onCreate;
    if (t === "level") { create?.({ kind: "level", low: at.p, high: at.p }); return; }
    if (t === "note") { create?.({ kind: "note", t1: at.t, p1: at.p }); return; }
    const first = draftRef.current;
    if (!first) { setDraft(at); return; }
    setDraft(null); setHover(null);
    if (t === "zone") {
      create?.({ kind: "zone", low: Math.min(first.p, at.p), high: Math.max(first.p, at.p) });
    } else {
      create?.({ kind: t, t1: first.t, p1: first.p, t2: at.t, p2: at.p });
    }
  }, [pointAt]);

  useEffect(() => {
    const el = wrapRef.current, chart = chartRef.current;
    if (!el || !chart) return;
    let down: { x: number; y: number; at: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.isPrimary) down = { x: e.clientX, y: e.clientY, at: e.timeStamp, id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || e.timeStamp - d.at > 600) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const g = buildGeom();
      // Taps on the price or time axis are the chart's, not a place to draw.
      if (!g || x < 0 || y < 0 || x > g.paneW || y > g.paneH) return;
      tapAt(x, y);
    };
    const onCancel = () => { down = null; };
    // The preview of the second point follows the pointer on a desktop; on a
    // phone it jumps to wherever the finger last touched, which is still useful.
    const move = (param: MouseEventParams<Time>) => {
      if (!toolRef.current || !draftRef.current || !param.point) return;
      setHover(pointAt(param.point.x, param.point.y));
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    chart.subscribeCrosshairMove(move);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      chart.unsubscribeCrosshairMove(move);
    };
  }, [pointAt, tapAt, buildGeom, decimals]);

  // The band the ladder filled into: always shown, never editable, not a drawing.
  const filled = useMemo(() => {
    if (!geom) return null;
    const top = geom.y(Math.max(zoneFromFills.low, zoneFromFills.high));
    const bot = geom.y(Math.min(zoneFromFills.low, zoneFromFills.high));
    if (top === null || bot === null) return null;
    return { top, height: Math.max(2, bot - top) };
  }, [geom, zoneFromFills]);

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

      <div className={`relative ${fill ? "min-h-0 flex-1" : ""}`} style={{ cursor: tool ? "crosshair" : undefined }}>
        {/* isolate: the chart layers its canvases with z-indexes of its own, which
            would otherwise rise above the drawings and swallow every tap on them. */}
        <div ref={wrapRef} className={fill ? "absolute inset-0 isolate overflow-hidden" : "isolate w-full"} />
        {filled && geom && (
          <div className="pointer-events-none absolute left-0"
               style={{
                 top: filled.top, height: filled.height, right: geom.rightPad,
                 background: "color-mix(in srgb, var(--c1) 14%, transparent)",
                 borderTop: "1px solid var(--c1)", borderBottom: "1px solid var(--c1)",
               }}>
            {/* Under the band rather than inside it: the trader's own name for a
                zone at the same price sits inside, top-left, and the two collided. */}
            <span className="absolute left-1 top-full mt-px rounded px-1 text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--c1)", background: "color-mix(in srgb, var(--s1) 82%, transparent)" }}>
              where you filled
            </span>
          </div>
        )}
        {geom && (
          <DrawingLayer
            geom={geom} drawings={drawings} tool={tool} draft={draft} hover={hover}
            selected={selected} onSelect={(id) => onSelect?.(id)} onMove={(d) => onMove?.(d)}
            decimals={decimals}
          />
        )}
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
