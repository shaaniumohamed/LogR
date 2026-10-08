"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, Eyebrow, Note } from "@/components/ui";
import { Info } from "@/components/info";
import { timeframes, type Timeframe } from "@/lib/core/market/bars";
import { priceDecimals } from "@/lib/core/instrument";
import { loadTickDay } from "@/lib/market/client";
import type { MarketChartStatus } from "@/components/market/market-chart";

// The chart touches the canvas when it is built, so it only runs in the browser.
const MarketChart = dynamic(() => import("@/components/market/market-chart").then((m) => m.MarketChart), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />,
});

/**
 * The stored history on a chart, at every timeframe the backtester will offer.
 *
 * This is the check that an import worked: candles where they should be, no
 * holes, volume and spread that look like gold. It scrolls through the whole
 * history like TradingView, and says how long each load took and how much came
 * from this device's own cache — the numbers the replay lives or dies by.
 */
export function Preview({ symbol, first, last, timeZone }: { symbol: string; first: string; last: string; timeZone: string }) {
  const tfs = useMemo(() => timeframes(), []);
  const [tf, setTf] = useState<Timeframe>(() => tfs[5]); // 30m
  const [day, setDay] = useState(last);
  const [goTo, setGoTo] = useState<{ time: number } | null>(null);
  const [status, setStatus] = useState<MarketChartStatus | null>(null);
  const [dayInfo, setDayInfo] = useState<string>("");

  // When MT5's day starts on the trader's clock, for the note under the chart.
  const dayOpens = useMemo(() => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
    .format(new Date(Date.UTC(2026, 0, 15))), [timeZone]);

  // The chosen day's ticks: count and spread, a quick read on data quality.
  useEffect(() => {
    let live = true;
    const daySec = Date.parse(`${day}T00:00:00Z`) / 1000;
    setDayInfo("");
    if (!Number.isFinite(daySec)) return;
    loadTickDay(symbol, daySec).then(({ ticks }) => {
      if (!live) return;
      if (!ticks) { setDayInfo(`${day}: no ticks held for this day.`); return; }
      let sum = 0, max = 0;
      for (let i = 0; i < ticks.count; i++) { const s = ticks.ask[i] - ticks.bid[i]; sum += s; if (s > max) max = s; }
      const k = 10 ** ticks.decimals;
      setDayInfo(`${day}: ${ticks.count.toLocaleString("en-US")} ticks · spread ${(sum / ticks.count / k).toFixed(3)} average, ${(max / k).toFixed(3)} widest`);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [symbol, day]);

  const statusLine = status && (status.error
    ? <span style={{ color: "var(--loss)" }}>{status.error}</span>
    : <>
        {status.candles.toLocaleString("en-US")} candles held{status.span ? ` (${status.span[0]} → ${status.span[1]})` : ""} · last load {status.ms} ms
        {" · "}{status.files} file{status.files === 1 ? "" : "s"} read, {status.fromCache} from this device
        {status.bytes ? `, ${(status.bytes / 1e6).toFixed(1)} MB downloaded` : ""}
      </>);

  return (
    <Card>
      <Eyebrow>Check it on a chart</Eyebrow>
      <Note>Drag to scroll back through the whole history; more loads as you go. Hover a candle to read it — on a phone, press and hold.</Note>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
          Go to
          <input type="date" value={day} min={first} max={last}
                 onChange={(e) => {
                   if (!e.target.value) return;
                   setDay(e.target.value);
                   setGoTo({ time: Date.parse(`${e.target.value}T12:00:00Z`) / 1000 });
                 }}
                 className="rounded-lg px-2.5 py-1.5 text-[13px]" style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }} />
        </label>
        <div className="seg flex-wrap" role="group" aria-label="Timeframe">
          {tfs.map((t) => (
            <button key={t.key} type="button" aria-pressed={t.key === tf.key} onClick={() => setTf(t)} className="!px-2 !py-1 !text-[12px]">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <MarketChart symbol={symbol} tf={tf} timeZone={timeZone} decimals={priceDecimals(symbol)} goTo={goTo} height={420} onStatus={setStatus} />
      </div>
      <p className="num mt-2 text-[12px]" style={{ color: "var(--ink3)" }}>{statusLine}</p>
      {dayInfo && <p className="num text-[12px]" style={{ color: "var(--ink3)" }}>{dayInfo}</p>}
      <Info title="Times on this chart">
        Times are shown on your own clock. Candles open and close on the broker&rsquo;s MT5 server
        time (UTC), exactly as they do in MT5, so a daily candle starts at {dayOpens} your time.
        The volume is the number of price changes in each candle — MT5&rsquo;s tick volume.
      </Info>
    </Card>
  );
}
