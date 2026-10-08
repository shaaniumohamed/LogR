"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { SeriesMarker, Time } from "lightweight-charts";
import type { Drawing, DrawingKind } from "lightweight-charts-drawing";
import { timeframes, type Timeframe } from "@/lib/core/market/bars";
import { SESSIONS, SPEEDS, barSpan, nextDayOpen, nextSessionOpen, stepBar } from "@/lib/core/replay/clock";
import type { SimAction, SimEvent } from "@/lib/core/sim/broker";
import type { BtChartPrefs, IndicatorSpec } from "@/lib/core/backtest";
import { priceDecimals } from "@/lib/core/instrument";
import { wallToUtc } from "@/lib/core/zones";
import { Replay } from "@/lib/market/replay";
import type { ChartHandle } from "@/lib/chart/handle";
import { kitInterval, labelPresets } from "@/lib/chart/kit";
import { TradeLines, attachLineDrag, type TradeLine } from "@/lib/chart/trade-lines";
import { SessionBoxes } from "@/lib/chart/session-boxes";
import type { LivePush } from "@/components/market/market-chart";
import { money } from "@/components/ui";
import { randomDay, saveSessionDrawings, saveSessionView } from "@/lib/backtest-actions";
import { AccountBar, History, Positions, StatsView, Ticket, type TicketDefaults } from "./panels";
import { ideaToTrade, type SessionProps, type TradeProps } from "./model";
import { useSaver } from "./use-saver";

const MarketChart = dynamic(() => import("@/components/market/market-chart").then((m) => m.MarketChart), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse" style={{ background: "var(--s3)" }} />,
});
const DrawingSystem = dynamic(() => import("@/components/chart/drawing-system").then((m) => m.DrawingSystem), { ssr: false });

const PRESET_INDICATORS: IndicatorSpec[] = [
  { id: "ema20", kind: "ema", period: 20, color: "#2962ff" },
  { id: "ema50", kind: "ema", period: 50, color: "#ff9800" },
  { id: "sma200", kind: "sma", period: 200, color: "#9c27b0" },
  { id: "vwap", kind: "vwap", period: 1, color: "#00bcd4" },
];

type Panel = "trade" | "positions" | "history" | "stats";
interface NewsItem { at: number; currency: string; title: string; impact: string }

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

/**
 * The backtest workspace: a replayed market, the drawing kit, and a simulated
 * account to trade it with.
 *
 * The replay (lib/market/replay.ts) owns the clock, the data and the account;
 * this screen draws what it says and sends it what the trader does. Nothing
 * after the replay clock ever reaches the chart.
 */
export function Workspace({ session, trades: initialTrades, timeZone }: { session: SessionProps; trades: TradeProps[]; timeZone: string }) {
  const tfs = useMemo(() => timeframes(), []);
  const decimals = priceDecimals(session.symbol);
  const [tf, setTf] = useState<Timeframe>(() => tfs.find((t) => t.key === session.timeframe) ?? tfs[2]);
  const [prefs, setPrefs] = useState<BtChartPrefs>(session.chart);
  const [trades, setTrades] = useState<TradeProps[]>(initialTrades);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<{ playing: boolean; loading: string | null }>({ playing: false, loading: "Loading prices…" });
  const [speed, setSpeedState] = useState<number>(() => read("logr.bt.speed", 60));
  const [until, setUntil] = useState<number | null>(null);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("trade");
  const [sheet, setSheet] = useState<Panel | "jump" | "chart" | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawKey, setDrawKey] = useState(0);
  const [ticketDefaults, setTicketDefaults] = useState<TicketDefaults>(() => read("logr.bt.ticket", { lots: 0.1, riskPct: 1, sizeBy: "risk" }));
  const [news, setNews] = useState<{ from: number; to: number; items: NewsItem[] }>({ from: 0, to: 0, items: [] });

  const replay = useRef<Replay | null>(null);
  const push = useRef<LivePush | null>(null);
  const tfRef = useRef(tf); tfRef.current = tf;
  const untilRef = useRef(until); untilRef.current = until;
  const tool = useRef<DrawingKind | null>(null);
  const lines = useRef<TradeLines | null>(null);
  const boxes = useRef<SessionBoxes | null>(null);
  const dragging = useRef<{ id: string; price: number } | null>(null);
  const lastUi = useRef(0);
  const allDrawings = useRef<Drawing[]>(session.drawings);
  const times = useRef<Record<string, number>>({ ...session.drawingTimes });

  const clockSec = () => Math.floor((replay.current?.clock ?? session.clockAt) / 1000);
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3500); }, []);

  const saver = useSaver(session.id, session.version, session.eventSeq, () => ({
    state: replay.current!.broker.snapshot(), clockSec: clockSec(),
  }));

  /* -------------------------------------------------------- the replay */

  const frame = useRef<() => void>(() => undefined);
  const onSim = useRef<(ev: SimEvent[]) => void>(() => undefined);

  useEffect(() => {
    const r = new Replay(session.symbol, session.settings, session.state, session.clockAt, {
      onFrame: () => frame.current(),
      onSim: (ev) => onSim.current(ev),
      onStatus: (s) => setStatus(s),
    });
    replay.current = r;
    r.speed = speed;
    void r.init().then(() => setUntil(barSpan(tfRef.current, Math.floor(r.clock / 1000)).start));
    return () => r.destroy();
    // One replay for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastChart = useRef(0);
  const chartGap = useRef(50);
  frame.current = () => {
    const r = replay.current;
    if (!r) return;
    // Playing, the chart is redrawn up to twenty times a second: enough to
    // watch the candles form, and at 1 h/s on the 1-minute chart a redraw on
    // every frame cannot keep up. The account still sees every tick between.
    const now = performance.now();
    if (r.playing && now - lastChart.current < chartGap.current) return;
    lastChart.current = now;
    const u = untilRef.current;
    if (u !== null && push.current) {
      const c = r.candles(tfRef.current, u);
      if (c) {
        push.current(c.closed, c.forming);
        // Scrolled far back, the chart holds more candles and each update
        // costs more: redraw less often rather than fall behind.
        chartGap.current = Math.min(500, Math.max(50, (performance.now() - now) * 4));
        // Fold a long run of live candles into the stored history now and then.
        if (c.closed.length > 4000) setUntil(barSpan(tfRef.current, Math.floor(r.clock / 1000)).start);
      }
    }
    drawLines();
    if (!r.playing || now - lastUi.current > 150) { lastUi.current = now; setTick((t) => t + 1); }
  };

  onSim.current = (ev) => {
    const ideas = ev.flatMap((e) => (e.kind === "idea" ? [e.idea] : []));
    if (ideas.length) {
      setTrades((ts) => {
        const known = new Set(ts.map((t) => t.ideaId));
        return ts.concat(ideas.filter((i) => !known.has(i.id)).map(ideaToTrade));
      });
      saver.finished(ideas);
    }
  };

  const onLive = useCallback((p: LivePush | null) => {
    push.current = p;
    if (p) frame.current();
  }, []);

  const setSpeed = (x: number) => { setSpeedState(x); write("logr.bt.speed", x); if (replay.current) replay.current.speed = x; };

  const togglePlay = () => {
    const r = replay.current;
    if (!r) return;
    if (r.playing) { r.pause(); saveView(); } else r.play();
  };

  const step = async (to: "bar" | "minute") => {
    const r = replay.current;
    if (!r || r.playing) return;
    const target = to === "bar" ? stepBar(tfRef.current, Math.floor(r.clock / 1000)) * 1000 : Math.floor(r.clock / 60_000) * 60_000 + 60_000;
    await r.advance(target);
    saveView();
  };

  const jumpTo = async (ms: number) => {
    const r = replay.current;
    if (!r) return;
    setSheet(null);
    const err = await r.jump(ms);
    if (err) { flash(err); return; }
    setUntil(barSpan(tfRef.current, Math.floor(r.clock / 1000)).start);
    refreshDrawings();
    saveView(true);
  };

  /* ---------------------------------------------------------- saving */

  const viewTimer = useRef(0);
  const saveView = useCallback((now = false) => {
    window.clearTimeout(viewTimer.current);
    const go = () => {
      void saveSessionView(session.id, { clockAt: clockSec(), timeframe: tfRef.current.key, chart: prefsRef.current });
    };
    if (now) go(); else viewTimer.current = window.setTimeout(go, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;

  // While playing, where the replay has got to is saved every few seconds.
  useEffect(() => {
    if (!status.playing) return;
    const t = window.setInterval(() => saveView(true), 5000);
    return () => window.clearInterval(t);
  }, [status.playing, saveView]);
  useEffect(() => () => { void saveSessionView(session.id, { clockAt: clockSec(), timeframe: tfRef.current.key, chart: prefsRef.current }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const act = useCallback((a: SimAction): string | null => {
    const r = replay.current;
    if (!r) return "Not ready yet.";
    const res = r.act(a);
    if (!res.ok) return res.error;
    saver.action(r.clock, a);
    return null;
  }, [saver]);

  const selectTf = (t: Timeframe) => {
    setTf(t);
    setUntil(barSpan(t, clockSec()).start);
    saveView();
  };

  const changePrefs = (p: BtChartPrefs) => { setPrefs(p); prefsRef.current = p; saveView(); };

  /* --------------------------------------------------------- drawings */

  // Drawings made later in the replay than the clock are kept but not shown.
  const visibleDrawings = useCallback(() => {
    const now = clockSec();
    return allDrawings.current.filter((d) => (times.current[d.id] ?? 0) <= now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refreshDrawings = () => setDrawKey((k) => k + 1);
  const saveDrawings = useCallback((shown: Drawing[]) => {
    const now = clockSec();
    for (const d of shown) if (!(d.id in times.current)) times.current[d.id] = now;
    const ids = new Set(shown.map((d) => d.id));
    const later = allDrawings.current.filter((d) => !ids.has(d.id) && (times.current[d.id] ?? 0) > now);
    allDrawings.current = [...shown, ...later];
    for (const id of Object.keys(times.current)) if (!allDrawings.current.some((d) => d.id === id)) delete times.current[id];
    void saveSessionDrawings(session.id, { v: 2, drawings: allDrawings.current }, times.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /** The Long/Short Position tool, turned into a real order. */
  const placeFromPosition = (d: Drawing) => {
    const r = replay.current;
    const p0 = d.points[0];
    if (!r || !p0) return;
    const side = d.kind === "long-position" ? "buy" : "sell";
    const st = d.style as { stopLevel?: number; profitLevel?: number };
    const dist = d.points[1] ? Math.abs(d.points[1].price - p0.price) : 0;
    const stopD = st.stopLevel ?? (dist || 1), profitD = st.profitLevel ?? (dist || 1);
    const entry = Math.round(p0.price * 100) / 100;
    const sl = Math.round((side === "buy" ? entry - stopD : entry + stopD) * 100) / 100;
    const tp = Math.round((side === "buy" ? entry + profitD : entry - profitD) * 100) / 100;
    const { bid, ask } = r.prices;
    const lots = ticketDefaults.sizeBy === "lots" ? ticketDefaults.lots : r.broker.lotsForRisk((r.broker.equity() * ticketDefaults.riskPct) / 100, entry, sl);
    if (!(lots >= r.broker.settings.minLot)) { flash("That risk is less than the smallest size at this stop distance."); return; }
    const market = side === "buy" ? ask : bid;
    const a: SimAction = Math.abs(entry - market) <= 0.3
      ? { kind: "market", side, lots, sl, tp }
      : { kind: "pending", side, type: side === "buy" ? (entry < ask ? "limit" : "stop") : (entry > bid ? "limit" : "stop"), price: entry, lots, sl, tp };
    const err = act(a);
    flash(err ?? (a.kind === "market" ? `${side === "buy" ? "Bought" : "Sold"} ${lots.toFixed(2)} lots.` : `${side === "buy" ? "Buy" : "Sell"} ${a.type} placed at ${entry.toFixed(2)}.`));
  };

  /* ----------------------------------------------- lines and boxes on the chart */

  function drawLines() {
    const r = replay.current, tl = lines.current;
    if (!r || !tl) return;
    const s = r.broker.state, contract = r.broker.settings.contractSize;
    const out: TradeLine[] = [];
    const at = (id: string, price: number) => (dragging.current?.id === id ? dragging.current.price : price);
    for (const p of s.positions) {
      const pnl = r.broker.floating(p) + p.commission + p.swap;
      const plAt = (px: number) => (p.side === "buy" ? px - p.openPrice : p.openPrice - px) * p.lots * contract;
      out.push({ id: `${p.id}:entry`, price: p.openPrice, label: `${p.side === "buy" ? "BUY" : "SELL"} ${p.lots.toFixed(2)}  ${money(pnl)}`, color: p.side === "buy" ? "#2962ff" : "#f23645", draggable: false, axis: true });
      if (p.sl !== null) { const px = at(`${p.id}:sl`, p.sl); out.push({ id: `${p.id}:sl`, price: px, label: `SL  ${money(plAt(px))}`, color: "#f23645", dashed: true, draggable: true, axis: true }); }
      if (p.tp !== null) { const px = at(`${p.id}:tp`, p.tp); out.push({ id: `${p.id}:tp`, price: px, label: `TP  ${money(plAt(px))}`, color: "#089981", dashed: true, draggable: true, axis: true }); }
    }
    for (const o of s.orders) {
      const px = at(`${o.id}:price`, o.price);
      out.push({ id: `${o.id}:price`, price: px, label: `${o.side === "buy" ? "BUY" : "SELL"} ${o.type.toUpperCase()} ${o.lots.toFixed(2)}`, color: "#787b86", dashed: true, draggable: true, axis: true });
      if (o.sl !== null) out.push({ id: `${o.id}:sl`, price: at(`${o.id}:sl`, o.sl), label: "SL", color: "#f23645", dashed: true, draggable: true });
      if (o.tp !== null) out.push({ id: `${o.id}:tp`, price: at(`${o.id}:tp`, o.tp), label: "TP", color: "#089981", dashed: true, draggable: true });
    }
    tl.set(out);
  }

  useEffect(() => {
    if (!handle) return;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";
    const tl = new TradeLines(font, decimals);
    const sb = new SessionBoxes(font);
    handle.series.attachPrimitive(sb);
    handle.series.attachPrimitive(tl);
    lines.current = tl;
    boxes.current = sb;
    sb.configure(prefsRef.current.sessions, tfRef.current.seconds);
    const detachDrag = attachLineDrag(handle, tl, {
      priceStep: 0.01,
      busy: () => tool.current !== null,
      onPreview: (id, price) => { dragging.current = { id, price }; drawLines(); },
      onCommit: (id, price) => {
        dragging.current = null;
        const [obj, field] = id.split(":");
        const a: SimAction = field === "price" ? { kind: "modify", id: obj, price } : { kind: "modify", id: obj, [field]: price };
        const err = act(a);
        if (err) flash(err);
        drawLines();
      },
    });
    drawLines();
    let gone = false;
    const off = () => {
      if (gone) return;
      gone = true;
      detachDrag();
      try { handle.series.detachPrimitive(tl); handle.series.detachPrimitive(sb); } catch { /* chart already gone */ }
      if (lines.current === tl) lines.current = null;
      if (boxes.current === sb) boxes.current = null;
    };
    const unregister = handle.onDispose(off);
    return () => { unregister(); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, decimals]);

  useEffect(() => { boxes.current?.configure(prefs.sessions, tf.seconds); }, [prefs.sessions, tf.seconds]);

  /* ------------------------------------------------------------- news */

  const nowSec = clockSec();
  useEffect(() => {
    if (prefs.news === "off") return;
    if (nowSec >= news.from && nowSec <= news.to - 7 * 86_400) return;
    const from = nowSec - 14 * 86_400, to = nowSec + 30 * 86_400;
    let live = true;
    fetch(`/api/news/events?from=${from}&to=${to}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j: { events: NewsItem[] }) => { if (live) setNews({ from, to, items: j.events }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [Math.floor(nowSec / 86_400), prefs.news]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------- markers */

  const r = replay.current;
  const positionsKey = r ? r.broker.state.positions.map((p) => p.id).join(",") : "";
  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    const out: SeriesMarker<Time>[] = [];
    const b = (ms: number) => tf.bucket(Math.floor(ms / 1000)) as Time;
    for (const t of trades) {
      for (const l of t.legs) {
        out.push({ time: b(l.openedAt), position: "atPriceMiddle", price: l.openPrice, shape: l.direction === "long" ? "arrowUp" : "arrowDown", color: l.direction === "long" ? "#2962ff" : "#f23645", size: 1 });
        out.push({ time: b(l.closedAt), position: "atPriceMiddle", price: l.closePrice, shape: "circle", color: l.profit + l.commission + l.swap >= 0 ? "#089981" : "#f23645", size: 0.8 });
      }
    }
    for (const p of replay.current?.broker.state.positions ?? []) {
      out.push({ time: b(p.openTime), position: "atPriceMiddle", price: p.openPrice, shape: p.side === "buy" ? "arrowUp" : "arrowDown", color: p.side === "buy" ? "#2962ff" : "#f23645", size: 1 });
    }
    if (prefs.news !== "off") {
      for (const n of news.items) {
        if (n.at > nowSec) continue;
        if (n.impact !== "high" && !(prefs.news === "medium" && n.impact === "medium")) continue;
        out.push({ time: tf.bucket(n.at) as Time, position: "aboveBar", shape: "square", color: n.impact === "high" ? "#f23645" : "#ff9800", size: 0.6, text: `${n.currency} ${n.title}`.slice(0, 22) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, tf, positionsKey, news, prefs.news, Math.floor(nowSec / 60)]);

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void step(e.shiftKey ? "minute" : "bar"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Full screen holds the page still underneath it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ------------------------------------------------------------- view */

  const clockText = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone,
  }), [timeZone]);
  const broker = r?.broker;
  const prices = r?.prices ?? { bid: NaN, ask: NaN };
  const openCount = (broker?.state.positions.length ?? 0) + (broker?.state.orders.length ?? 0);

  const panels = (p: Panel) => !broker ? null : p === "trade"
    ? <Ticket broker={broker} bid={prices.bid} ask={prices.ask} defaults={ticketDefaults}
              onDefaults={(d) => { setTicketDefaults(d); write("logr.bt.ticket", d); }} onPlace={act} />
    : p === "positions" ? <Positions broker={broker} onAct={act} />
    : p === "history" ? <History trades={trades} timeZone={timeZone} />
    : <StatsView trades={trades} compact />;

  const tabs: [Panel, string][] = [["trade", "Trade"], ["positions", `Open${openCount ? ` (${openCount})` : ""}`], ["history", "History"], ["stats", "Stats"]];

  const saveText = saver.status === "conflict" ? null : saver.status === "error" ? "Not saved — retrying" : saver.status === "saving" ? "Saving…" : saver.status === "saved" ? "Saved" : "";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "var(--plane)" }}>
      {/* Top bar */}
      <header className="flex items-center gap-2 px-3 pb-1.5 pt-[max(8px,env(safe-area-inset-top))]" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href={`/backtest/strategy/${session.strategy.id}`} aria-label="Back to the strategy"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--s3)", color: "var(--ink)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 3 5 8l5 5" /></svg>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{session.name}</div>
          <div className="num truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{clockText.format(new Date(r?.clock ?? session.clockAt))}</div>
        </div>
        <span className="hidden text-[11.5px] sm:inline" style={{ color: saver.status === "error" ? "var(--loss)" : "var(--ink3)" }}>{saveText}</span>
        <button type="button" onClick={() => setDrawOpen((o) => !o)} aria-pressed={drawOpen} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold lg:hidden"
                style={drawOpen ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)" }}>Draw</button>
        <button type="button" onClick={() => setSheet("chart")} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--s3)" }}>Chart</button>
      </header>

      {saver.status === "conflict" && (
        <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)" }} role="alert">
          <span className="flex-1">This session was saved from another tab or device. Reload to carry on from there.</span>
          <button type="button" className="btn btn-primary !py-1 !text-[12.5px]" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}

      {/* Timeframes */}
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-3 py-1.5">
        <div className="seg shrink-0" role="group" aria-label="Timeframe">
          {tfs.map((t) => (
            <button key={t.key} type="button" aria-pressed={t.key === tf.key} onClick={() => selectTf(t)} className="!px-2 !py-1 !text-[12px]">{t.label}</button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {handle && (
            <div className={`px-3 pb-1.5 ${drawOpen ? "" : "hidden lg:block"}`}>
              <DrawingSystem key={drawKey} handle={handle} initial={visibleDrawings()} onSave={saveDrawings}
                             presets={labelPresets} interval={kitInterval(tf.key)} timeZone={timeZone} decimals={decimals}
                             pageScroll={false} onTool={(k) => { tool.current = k; }}
                             selectionActions={(d) => (d.kind === "long-position" || d.kind === "short-position") ? (
                               <button type="button" onClick={() => placeFromPosition(d)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-white"
                                       style={{ background: d.kind === "long-position" ? "#2962ff" : "#f23645" }}>Place order</button>
                             ) : null} />
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {until !== null && (
              <MarketChart symbol={session.symbol} tf={tf} timeZone={timeZone} decimals={decimals} fill
                           until={until} onLive={onLive} onReady={setHandle}
                           type={prefs.type} volume={prefs.volume} indicators={prefs.indicators} markers={markers} />
            )}
            {status.loading && (
              <div className="pointer-events-none absolute left-1/2 top-12 z-[7] -translate-x-1/2 rounded-full px-3 py-1 text-[12px] font-medium"
                   style={{ background: "var(--s1)", boxShadow: "0 2px 10px rgb(0 0 0 / 0.18)" }}>{status.loading}</div>
            )}
            {toast && (
              <div className="absolute bottom-12 left-1/2 z-[8] max-w-[90%] -translate-x-1/2 rounded-lg px-3 py-2 text-[12.5px] font-medium"
                   style={{ background: "var(--ink)", color: "var(--plane)" }} role="status">{toast}</div>
            )}
          </div>

          {/* Replay controls */}
          <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderTop: "1px solid var(--line)" }}>
            <button type="button" onClick={() => setSheet("jump")} className="rounded-lg px-2.5 py-2 text-[12.5px] font-semibold" style={{ background: "var(--s3)" }}>Go to</button>
            <button type="button" onClick={togglePlay} aria-label={status.playing ? "Pause" : "Play"} title="Play / pause (space)"
                    className="flex h-9 w-11 items-center justify-center rounded-lg text-white" style={{ background: "var(--c1)" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">
                {status.playing ? <path d="M3 2h3v10H3zM8 2h3v10H8z" /> : <path d="M3 1.5v11l9-5.5z" />}
              </svg>
            </button>
            <button type="button" onClick={() => void step("bar")} disabled={status.playing} title="Step one candle (→)" className="rounded-lg px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-40" style={{ background: "var(--s3)" }}>
              +1 candle
            </button>
            <button type="button" onClick={() => void step("minute")} disabled={status.playing} title="Step one minute (shift →)" className="hidden rounded-lg px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-40 sm:block" style={{ background: "var(--s3)" }}>
              +1 min
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink3)" }}>
              <span className="hidden sm:inline">Speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed"
                      className="h-9 rounded-lg px-2 text-[12.5px]" style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                {SPEEDS.map((s) => <option key={s.x} value={s.x}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {/* Quick trade strip: phones and tablets. Sell and buy open the ticket at the live price. */}
          {broker && (
            <div className="space-y-1.5 px-3 pb-1.5 lg:hidden">
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setSheet("trade")} className="rounded-lg px-3 py-1.5 text-left text-white" style={{ background: "#f23645" }}>
                  <span className="block text-[10.5px] font-semibold uppercase">Sell</span>
                  <span className="num block text-[15px] font-bold">{Number.isFinite(prices.bid) ? prices.bid.toFixed(2) : "—"}</span>
                </button>
                <button type="button" onClick={() => setSheet("trade")} className="rounded-lg px-3 py-1.5 text-right text-white" style={{ background: "#2962ff" }}>
                  <span className="block text-[10.5px] font-semibold uppercase">Buy</span>
                  <span className="num block text-[15px] font-bold">{Number.isFinite(prices.ask) ? prices.ask.toFixed(2) : "—"}</span>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {tabs.slice(1).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setSheet(k)} className="rounded-lg py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--s3)" }}>{l}</button>
                ))}
              </div>
            </div>
          )}
          {broker && <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }}><AccountBar broker={broker} /></div>}
        </main>

        {/* Side panel: desktops */}
        <aside className="hidden w-[340px] shrink-0 flex-col lg:flex" style={{ borderLeft: "1px solid var(--line)" }}>
          <div className="seg m-2" role="tablist">
            {tabs.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={panel === k} aria-pressed={panel === k} onClick={() => setPanel(k)} className="flex-1 !px-2 !py-1 !text-[12px]">{l}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{panels(panel)}</div>
        </aside>
      </div>

      {/* Sheets */}
      {sheet && (
        <Sheet title={sheet === "jump" ? "Go to" : sheet === "chart" ? "Chart" : tabs.find(([k]) => k === sheet)?.[1] ?? ""} onClose={() => setSheet(null)}>
          {sheet === "jump" ? (
            <JumpPanel timeZone={timeZone} range={session.range} clock={r?.clock ?? session.clockAt} news={news.items} onJump={jumpTo} onError={flash} />
          ) : sheet === "chart" ? (
            <ChartOptions prefs={prefs} onChange={changePrefs} />
          ) : panels(sheet)}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center md:items-center" role="dialog" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: "rgb(0 0 0 / 0.4)" }} onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 md:rounded-2xl"
           style={{ background: "var(--s1)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <div className="mb-3 flex items-center">
          <span className="text-[15px] font-semibold">{title}</span>
          <button type="button" onClick={onClose} className="tap ml-auto text-[13px] font-semibold" style={{ color: "var(--c1)" }}>Done</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Where to go: a date and time, a random day, the next session open, the next news release. */
function JumpPanel({ timeZone, range, clock, news, onJump, onError }: {
  timeZone: string;
  range: { first: string; last: string } | null;
  clock: number;
  news: NewsItem[];
  onJump: (ms: number) => void;
  onError: (m: string) => void;
}) {
  const local = useMemo(() => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
      .formatToParts(new Date(clock)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
  }, [clock, timeZone]);
  const [when, setWhen] = useState(local);
  const [busy, setBusy] = useState(false);
  const sec = Math.floor(clock / 1000);
  const nextNews = news.find((n) => n.at > sec + 60 && n.impact === "high");
  const go = (s: number) => onJump(s * 1000);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ink3)" }}>Date and time (your clock)</label>
        <div className="flex gap-2">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                 min={range ? `${range.first}T00:00` : undefined} max={range ? `${range.last}T23:59` : undefined}
                 className="h-10 min-w-0 flex-1 rounded-lg px-2.5 text-[13.5px]" style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
          <button type="button" className="btn btn-primary" onClick={() => {
            const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when);
            if (!m) return onError("Pick a date and time.");
            go(Math.floor(wallToUtc(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), timeZone) / 1000));
          }}>Go</button>
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>Going back in time needs no open trades or orders; going forward plays through everything in between.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SESSIONS.map((s) => (
          <button key={s.id} type="button" className="btn btn-secondary !text-[13px]" onClick={() => go(nextSessionOpen(s, sec))}>Next {s.label} open</button>
        ))}
        <button type="button" className="btn btn-secondary !text-[13px]" onClick={() => go(nextDayOpen(sec))}>Next day</button>
        <button type="button" className="btn btn-secondary !text-[13px]" disabled={!nextNews} onClick={() => nextNews && go(nextNews.at - 120)}
                title={nextNews ? `${nextNews.currency} ${nextNews.title}` : "No high-impact release imported in the next month"}>
          Next big news
        </button>
        <button type="button" className="btn btn-secondary col-span-2 !text-[13px]" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await randomDay();
          setBusy(false);
          if (!r.ok) return onError(r.error);
          go(Date.parse(`${r.day}T00:00:00Z`) / 1000);
        }}>{busy ? "Picking…" : "A random day"}</button>
      </div>
      {nextNews && (
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          Next big news: {nextNews.currency} {nextNews.title}, {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(nextNews.at * 1000))}.
          The jump stops two minutes before it.
        </p>
      )}
    </div>
  );
}

function ChartOptions({ prefs, onChange }: { prefs: BtChartPrefs; onChange: (p: BtChartPrefs) => void }) {
  const has = (id: string) => prefs.indicators.some((i) => i.id === id);
  const toggle = (spec: IndicatorSpec) => onChange({
    ...prefs, indicators: has(spec.id) ? prefs.indicators.filter((i) => i.id !== spec.id) : [...prefs.indicators, spec],
  });
  const Row = ({ label, on, onClick, colour }: { label: string; on: boolean; onClick: () => void; colour?: string }) => (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-[13.5px]">
      {colour && <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />}
      <span className="flex-1">{label}</span>
      <span className="relative h-6 w-10 shrink-0 rounded-full" style={{ background: on ? "var(--c1)" : "var(--s3)", boxShadow: on ? undefined : "inset 0 0 0 1px var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-150" style={{ left: on ? 18 : 2, background: "#fff", boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)" }} />
      </span>
    </button>
  );
  return (
    <div className="space-y-1">
      <div className="seg mb-2 w-full" role="group" aria-label="Chart type">
        {(["candles", "line"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={prefs.type === t} onClick={() => onChange({ ...prefs, type: t })} className="flex-1 !py-1.5 !text-[12.5px]">{t === "candles" ? "Candles" : "Line (closes)"}</button>
        ))}
      </div>
      {PRESET_INDICATORS.map((s) => (
        <Row key={s.id} label={s.kind === "vwap" ? "VWAP (daily)" : `${s.kind.toUpperCase()} ${s.period}`} colour={s.color} on={has(s.id)} onClick={() => toggle(s)} />
      ))}
      <Row label="Volume" on={prefs.volume} onClick={() => onChange({ ...prefs, volume: !prefs.volume })} />
      <Row label="Session boxes (Tokyo, London, New York)" on={prefs.sessions} onClick={() => onChange({ ...prefs, sessions: !prefs.sessions })} />
      <div className="pt-2">
        <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ink3)" }}>News on the chart</span>
        <div className="seg w-full" role="group" aria-label="News">
          {([["off", "Off"], ["high", "High impact"], ["medium", "High + medium"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={prefs.news === k} onClick={() => onChange({ ...prefs, news: k })} className="flex-1 !py-1.5 !text-[12px]">{l}</button>
          ))}
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>Releases come from the calendar imported under Import → News.</p>
      </div>
    </div>
  );
}
