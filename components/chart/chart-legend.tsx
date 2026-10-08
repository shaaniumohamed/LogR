"use client";

import { useEffect, useMemo, useState } from "react";
import { MismatchDirection, type IChartApi, type ISeriesApi, type MouseEventParams, type Time } from "lightweight-charts";

interface Bar { o: number; h: number; l: number; c: number; prev: number | null; v: number | null }

/**
 * The line of numbers at the top left of a chart, as on TradingView: the
 * open, high, low and close of the candle under the cursor (or the latest one
 * when nothing is hovered), its change from the candle before, and its volume
 * at the top of the volume pane.
 *
 * It reads the chart's own data rather than keeping a copy, so it is always
 * describing exactly the candle drawn. `version` tells it the data changed and
 * the "latest candle" view needs refreshing.
 */
export function ChartLegend({ chart, candles, volume, title, decimals, version }: {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume?: ISeriesApi<"Histogram"> | null;
  title: string;
  decimals: number;
  version: number;
}) {
  const [bar, setBar] = useState<Bar | null>(null);
  const [volTop, setVolTop] = useState<number | null>(null);

  useEffect(() => {
    const read = (index: number): Bar | null => {
      const d = candles.dataByIndex(index) as { open?: number; high?: number; low?: number; close?: number } | null;
      if (!d || d.open === undefined || d.close === undefined) return null;
      const p = candles.dataByIndex(index - 1) as { close?: number } | null;
      const v = volume ? (volume.dataByIndex(index) as { value?: number } | null)?.value ?? null : null;
      return { o: d.open, h: d.high ?? d.open, l: d.low ?? d.open, c: d.close, prev: p?.close ?? null, v };
    };
    const latest = () => {
      // The last candle's index: step in from far to the right.
      const last = candles.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft) as { time?: Time } | null;
      if (!last?.time) return null;
      const idx = chart.timeScale().timeToIndex(last.time, true);
      return idx === null ? null : read(idx);
    };
    let frame = 0;
    let pending: MouseEventParams<Time> | null = null;
    const apply = () => {
      frame = 0;
      const p = pending;
      setBar(p && p.point && p.logical !== undefined ? read(Math.round(p.logical)) ?? latest() : latest());
      if (volume) {
        const h = chart.paneSize(0).height;
        setVolTop(h > 0 ? h + 6 : null);
      }
    };
    const onMove = (p: MouseEventParams<Time>) => {
      pending = p;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chart, candles, volume, version]);

  const fmt = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false }), [decimals]);
  const compact = useMemo(() => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }), []);

  const tone = bar ? (bar.c >= bar.o ? "var(--profit)" : "var(--loss)") : "var(--ink2)";
  const change = bar && bar.prev !== null ? bar.c - bar.prev : null;
  const back = "color-mix(in srgb, var(--plane) 72%, transparent)";

  return (
    <>
      <div className="num pointer-events-none absolute left-1.5 top-1 z-[5] flex max-w-[calc(100%-70px)] flex-wrap items-baseline gap-x-2 gap-y-0 rounded px-1 text-[11.5px] leading-[1.45]"
           style={{ background: back, color: "var(--ink3)" }} aria-live="off">
        <span className="font-semibold" style={{ color: "var(--ink)" }}>{title}</span>
        {bar && (
          <>
            <span>O <span style={{ color: tone }}>{fmt.format(bar.o)}</span></span>
            <span>H <span style={{ color: tone }}>{fmt.format(bar.h)}</span></span>
            <span>L <span style={{ color: tone }}>{fmt.format(bar.l)}</span></span>
            <span>C <span style={{ color: tone }}>{fmt.format(bar.c)}</span></span>
            {change !== null && bar.prev ? (
              <span style={{ color: change >= 0 ? "var(--profit)" : "var(--loss)" }}>
                {change >= 0 ? "+" : "−"}{fmt.format(Math.abs(change))} ({change >= 0 ? "+" : "−"}{Math.abs((change / bar.prev) * 100).toFixed(2)}%)
              </span>
            ) : null}
          </>
        )}
      </div>
      {volume && bar?.v != null && volTop !== null && (
        <div className="num pointer-events-none absolute left-1.5 z-[5] rounded px-1 text-[11px]"
             style={{ top: volTop, background: back, color: "var(--ink3)" }}>
          Vol <span style={{ color: tone }}>{compact.format(bar.v)}</span>
        </div>
      )}
    </>
  );
}
