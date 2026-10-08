"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, HistogramSeries, createChart,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { Card, Eyebrow, Note } from "@/components/ui";
import { timeframes, toCandles, type Timeframe } from "@/lib/core/market/bars";
import { loadCandles, loadTickDay } from "@/lib/market/client";

const DAY = 86_400;

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** How much history each timeframe shows around the chosen day. */
function windowFor(tf: Timeframe, daySec: number, first: number, last: number): [number, number] {
  if (tf.seconds < 3_600) return [daySec - 2 * DAY, daySec + DAY];
  if (tf.seconds < DAY) return [daySec - 90 * DAY, daySec + 7 * DAY];
  return [first, last + DAY];
}

/**
 * The stored history on a chart, at every timeframe the backtester will offer.
 *
 * This is the check that an import worked: candles where they should be, no
 * holes, volume and spread that look like gold. It also shows how long a load
 * took and how much came from this device's own cache, which is the number the
 * replay will live or die by.
 */
export function Preview({ symbol, first, last }: { symbol: string; first: string; last: string }) {
  const tfs = useMemo(() => timeframes(), []);
  const [tf, setTf] = useState<Timeframe>(() => tfs[2]); // 5m
  const [day, setDay] = useState(last);
  const [status, setStatus] = useState<string>("");
  const [dayInfo, setDayInfo] = useState<string>("");
  const wrap = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--ink3", "#888"), fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: cssVar("--line", "#0001") }, horzLines: { color: cssVar("--line", "#0001") } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: cssVar("--line", "#0001") },
      rightPriceScale: { borderColor: cssVar("--line", "#0001") },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: cssVar("--profit", "#1baf7a"), downColor: cssVar("--loss", "#e34948"), borderVisible: false,
      wickUpColor: cssVar("--profit", "#1baf7a"), wickDownColor: cssVar("--loss", "#e34948"),
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    // Tick volume in a pane of its own, the way MT5 shows it under the price.
    volume.current = c.addSeries(HistogramSeries, { color: cssVar("--ink3", "#888"), priceFormat: { type: "volume" } }, 1);
    c.panes()[1]?.setHeight(70);
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    let live = true;
    const daySec = Date.parse(`${day}T00:00:00Z`) / 1000;
    if (!Number.isFinite(daySec)) return;
    const [from, to] = windowFor(tf, daySec, Date.parse(`${first}T00:00:00Z`) / 1000, Date.parse(`${last}T00:00:00Z`) / 1000);
    setStatus("Loading…");
    const t0 = performance.now();
    loadCandles(symbol, tf, from, to).then(({ bars, stats }) => {
      if (!live) return;
      const ms = Math.round(performance.now() - t0);
      if (!bars) { candles.current?.setData([]); volume.current?.setData([]); setStatus("No data held for this span."); return; }
      const cs = toCandles(bars);
      candles.current?.setData(cs.map((x) => ({ time: x.time as UTCTimestamp, open: x.open, high: x.high, low: x.low, close: x.close })));
      volume.current?.setData(cs.map((x) => ({ time: x.time as UTCTimestamp, value: x.volume })));
      chart.current?.timeScale().fitContent();
      setStatus(`${cs.length.toLocaleString("en-US")} candles in ${ms} ms · ${stats.files} file${stats.files === 1 ? "" : "s"}, ${stats.fromCache} from this device${stats.bytes ? `, ${(stats.bytes / 1e6).toFixed(1)} MB downloaded` : ""}`);
    }).catch((e) => live && setStatus(e instanceof Error ? e.message : "Could not load."));
    return () => { live = false; };
  }, [symbol, tf, day, first, last]);

  // The chosen day's ticks: count and spread, a quick read on data quality.
  useEffect(() => {
    let live = true;
    const daySec = Date.parse(`${day}T00:00:00Z`) / 1000;
    setDayInfo("");
    loadTickDay(symbol, daySec).then(({ ticks }) => {
      if (!live || !ticks) return;
      let sum = 0, max = 0;
      for (let i = 0; i < ticks.count; i++) { const s = ticks.ask[i] - ticks.bid[i]; sum += s; if (s > max) max = s; }
      const k = 10 ** ticks.decimals;
      setDayInfo(`${day}: ${ticks.count.toLocaleString("en-US")} ticks · spread ${(sum / ticks.count / k).toFixed(3)} average, ${(max / k).toFixed(3)} widest`);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [symbol, day]);

  return (
    <Card>
      <Eyebrow>Check it on a chart</Eyebrow>
      <Note>Times are UTC. Pick a day and a timeframe; the same files will feed the backtester.</Note>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="date" value={day} min={first} max={last} onChange={(e) => e.target.value && setDay(e.target.value)}
               className="rounded-lg px-2.5 py-1.5 text-[13px]" style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }} />
        <div className="seg flex-wrap" role="group" aria-label="Timeframe">
          {tfs.map((t) => (
            <button key={t.key} type="button" aria-pressed={t.key === tf.key} onClick={() => setTf(t)} className="!px-2 !py-1 !text-[12px]">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrap} className="mt-3 h-[340px] w-full" />
      <p className="num mt-2 text-[12px]" style={{ color: "var(--ink3)" }}>{status}</p>
      {dayInfo && <p className="num text-[12px]" style={{ color: "var(--ink3)" }}>{dayInfo}</p>}
    </Card>
  );
}
