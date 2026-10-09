"use client";

import { memo, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Side } from "@/lib/core/sim/broker";

/** Where the replay writes the live prices, many times a second, without re-rendering anything. */
export interface QuoteSink { set(bid: number, ask: number, spread: number | null): void }

/**
 * One-click trading, as on MT5 and TradingView: SELL at the bid, BUY at the
 * ask, the size between them. A click fills at the market straight away —
 * no stop needed, no confirmation; the stop and target are dragged out from
 * the entry line afterwards.
 *
 * On a laptop it sits on the chart under the price readout; on a phone it is
 * a strip of big buttons above the replay controls.
 */
export const OneClick = memo(function OneClick({ layout, lots, lotStep, minLot, decimals, disabled, onLots, onTrade, sink }: {
  layout: "chart" | "strip";
  lots: number;
  lotStep: number;
  minLot: number;
  decimals: number;
  disabled: boolean;
  onLots: (lots: number) => void;
  onTrade: (side: Side) => void;
  sink: MutableRefObject<QuoteSink | null>;
}) {
  const bidEl = useRef<HTMLSpanElement>(null);
  const askEl = useRef<HTMLSpanElement>(null);
  const spreadEl = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(lots.toFixed(2));
  const repeat = useRef<{ t: number; i: number } | null>(null);
  const lotsRef = useRef(lots);
  lotsRef.current = lots;

  useEffect(() => { setText(lots.toFixed(2)); }, [lots]);
  useEffect(() => {
    sink.current = {
      set(bid, ask, sp) {
        if (bidEl.current) bidEl.current.textContent = Number.isFinite(bid) ? bid.toFixed(decimals) : "—";
        if (askEl.current) askEl.current.textContent = Number.isFinite(ask) ? ask.toFixed(decimals) : "—";
        if (spreadEl.current) spreadEl.current.textContent = sp === null ? "" : `spread ${sp.toFixed(decimals)}`;
      },
    };
    return () => { sink.current = null; };
  }, [sink, decimals]);

  const clamp = (v: number) => Math.max(minLot, Math.round(Math.round(v / lotStep) * lotStep * 100) / 100);
  const step = (dir: 1 | -1) => onLots(clamp(lotsRef.current + dir * lotStep));
  const startRepeat = (dir: 1 | -1) => {
    step(dir);
    const t = window.setTimeout(() => {
      const i = window.setInterval(() => step(dir), 120);
      if (repeat.current) repeat.current.i = i;
    }, 400);
    repeat.current = { t, i: 0 };
  };
  const stopRepeat = () => {
    if (!repeat.current) return;
    window.clearTimeout(repeat.current.t);
    window.clearInterval(repeat.current.i);
    repeat.current = null;
  };
  useEffect(() => stopRepeat, []);

  const commitText = () => {
    const v = Number(text.replace(",", "."));
    if (Number.isFinite(v) && v > 0) onLots(clamp(v)); else setText(lotsRef.current.toFixed(2));
  };

  const strip = layout === "strip";
  const tradeBtn = (side: Side) => (
    <button type="button" disabled={disabled} onClick={() => onTrade(side)}
            aria-label={side === "buy" ? "Buy at market" : "Sell at market"} title={`${side === "buy" ? "Buy" : "Sell"} at market (shift ${side === "buy" ? "B" : "S"})`}
            className={`flex flex-col justify-center rounded-lg px-2.5 text-white transition-opacity disabled:opacity-40 ${strip ? "h-11" : "h-9 min-w-[78px]"} ${side === "buy" ? "items-end text-right" : "items-start text-left"}`}
            style={{ background: side === "buy" ? "#2962ff" : "#f23645" }}>
      <span className="text-[9.5px] font-bold uppercase leading-none tracking-wide opacity-90">{side === "buy" ? "Buy" : "Sell"}</span>
      <span ref={side === "buy" ? askEl : bidEl} className={`num font-bold leading-tight ${strip ? "text-[15px]" : "text-[13px]"}`}>—</span>
    </button>
  );
  const stepBtn = (dir: 1 | -1) => (
    <button type="button" aria-label={dir === 1 ? "More lots" : "Fewer lots"}
            onPointerDown={(e) => { e.preventDefault(); startRepeat(dir); }} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}
            className={`grid place-items-center font-bold ${strip ? "h-9 w-9 text-[16px]" : "h-7 w-6 text-[13px]"}`} style={{ color: "var(--ink2)" }}>
      {dir === 1 ? "+" : "−"}
    </button>
  );
  const stepper = (
    <div className={`flex flex-col items-center justify-center ${strip ? "" : "px-0.5"}`}>
      <div className="flex items-center rounded-lg" style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
        {stepBtn(-1)}
        <input inputMode="decimal" value={text} aria-label="Lots"
               onChange={(e) => setText(e.target.value)} onBlur={commitText}
               onKeyDown={(e) => { if (e.key === "Enter") { commitText(); (e.target as HTMLInputElement).blur(); } }}
               className={`num bg-transparent text-center font-semibold outline-none ${strip ? "w-14 text-[14px]" : "w-11 text-[12.5px]"}`} style={{ color: "var(--ink)" }} />
        {stepBtn(1)}
      </div>
      <span ref={spreadEl} className="num mt-0.5 text-[9.5px] leading-none" style={{ color: "var(--ink3)" }} />
    </div>
  );

  if (strip) {
    return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">{tradeBtn("sell")}{stepper}{tradeBtn("buy")}</div>;
  }
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl p-1"
         style={{ background: "color-mix(in srgb, var(--s1) 82%, transparent)", border: "1px solid var(--line)", boxShadow: "0 2px 10px rgb(0 0 0 / 0.10)" }}>
      {tradeBtn("sell")}{stepper}{tradeBtn("buy")}
    </div>
  );
});
