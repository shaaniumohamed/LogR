"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { SeriesMarker, Time } from "lightweight-charts";
import type { Drawing, DrawingKind } from "lightweight-charts-drawing";
import { timeframes, type Timeframe } from "@/lib/core/market/bars";
import { SESSIONS, SPEEDS, START_WHEN, barSpan, nextDayOpen, nextSessionOpen, startTimeFor, stepBar, type StartWhen } from "@/lib/core/replay/clock";
import { DEFAULT_AUTOPAUSE, nextPausePoint, pauseForEvent, type AutoPause, type PauseReason } from "@/lib/core/replay/pauses";
import type { OpenPosition, PendingOrder, SimAction, SimEvent, Side } from "@/lib/core/sim/broker";
import type { BtChartPrefs, BtLink, IndicatorSpec } from "@/lib/core/backtest";
import { priceDecimals } from "@/lib/core/instrument";
import { wallToUtc } from "@/lib/core/zones";
import { Replay } from "@/lib/market/replay";
import type { ChartHandle } from "@/lib/chart/handle";
import { kitInterval, labelPresets } from "@/lib/chart/kit";
import { TradeLines, type LineTab, type TradeLine } from "@/lib/chart/trade-lines";
import { attachLineInteraction, type LineIntent } from "@/lib/chart/line-interaction";
import { SessionBoxes } from "@/lib/chart/session-boxes";
import { TradePaths } from "@/lib/chart/trade-paths";
import { PickOverlay } from "@/lib/chart/pick-overlay";
import { attachPickLayer, type PickedCandle } from "@/lib/chart/pick-layer";
import { riskMoneyOf } from "@/lib/chart/linked-position";
import { createSounds, type SoundKind } from "@/lib/sound";
import type { LivePush, MarketChartControl, SavedView, ViewRequest } from "@/components/market/market-chart";
import { money } from "@/components/ui";
import { Info } from "@/components/info";
import { randomDay, saveSessionDrawings, saveSessionView } from "@/lib/backtest-actions";
import { AccountBar, History, Positions, StatsView, Ticket, type TicketDefaults } from "./panels";
import { ideaToTrade, type SessionProps, type TradeProps } from "./model";
import { useSaver } from "./use-saver";
import { OneClick, type QuoteSink } from "./one-click";
import { PriceEditor, type PriceField, type PriceKey } from "./price-editor";
import { Toasts, useToasts, type ToastTone } from "./toasts";
import { ShortcutsList, useShortcuts, type ShortcutAction } from "./shortcuts";
import { useLinkedPositions } from "./use-linked-positions";

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

const BUY = "#2962ff", SELL = "#f23645", SL = "#f23645", TP = "#089981", ORDER = "#787b86", ASK = "#e57373";

type Panel = "trade" | "positions" | "history" | "stats";
type SheetKind = Panel | "jump" | "chart" | "keys";
interface NewsItem { at: number; currency: string; title: string; impact: string }
interface Feedback { sounds: boolean; toasts: boolean }

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...(JSON.parse(v) as T) } : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };
const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));
const fmtR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;
const REASON: Record<string, string> = { sl: "stop-loss", tp: "take-profit", so: "stop-out", user: "closed", unknown: "closed" };

/**
 * The backtest workspace: a replayed market, the drawing kit, and a simulated
 * account to trade it with — laid out to feel like MT5.
 *
 * The replay (lib/market/replay.ts) owns the clock, the data and the account;
 * this screen draws what it says and sends it what the trader does. Nothing
 * after the replay clock ever reaches the chart, except while the trader is
 * picking where to start (the future is dimmed then, and gone once picked).
 */
export function Workspace({ session, trades: initialTrades, timeZone, startInPick = false }: {
  session: SessionProps;
  trades: TradeProps[];
  timeZone: string;
  startInPick?: boolean;
}) {
  const router = useRouter();
  const tfs = useMemo(() => timeframes(), []);
  const decimals = priceDecimals(session.symbol);
  const [tf, setTf] = useState<Timeframe>(() => tfs.find((t) => t.key === session.timeframe) ?? tfs[2]);
  const [prefs, setPrefs] = useState<BtChartPrefs>(session.chart);
  const [trades, setTrades] = useState<TradeProps[]>(initialTrades);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<{ playing: boolean; loading: string | null }>({ playing: false, loading: "Loading prices…" });
  const [speed, setSpeedState] = useState<number>(() => read<{ v: number }>("logr.bt.speed.v2", { v: 60 }).v);
  const [until, setUntil] = useState<number | null>(null);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  const [panel, setPanel] = useState<Panel>("trade");
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawKey, setDrawKey] = useState(0);
  const [ticketDefaults, setTicketDefaults] = useState<TicketDefaults>({ lots: 0.1, riskPct: 1, sizeBy: "lots" });
  const [autoPause, setAutoPause] = useState<AutoPause>(DEFAULT_AUTOPAUSE);
  const [feedback, setFeedback] = useState<Feedback>({ sounds: true, toasts: true });
  const [news, setNews] = useState<{ from: number; to: number; items: NewsItem[] }>({ from: 0, to: 0, items: [] });
  const [pick, setPick] = useState(false);
  const [viewReq, setViewReq] = useState<ViewRequest | null>(null);
  const [editor, setEditor] = useState<{ line: TradeLine; field: "sl" | "tp" | "price" | "all"; at: { x: number; y: number } } | null>(null);
  const toasts = useToasts();

  // Per-device settings, read after mounting (the page is also rendered on the server).
  useEffect(() => {
    setTicketDefaults(read<TicketDefaults>("logr.bt.ticket", { lots: 0.1, riskPct: 1, sizeBy: "lots" }));
    setAutoPause(read<AutoPause>("logr.bt.autopause", DEFAULT_AUTOPAUSE));
    setFeedback(read<Feedback>("logr.bt.feedback", { sounds: true, toasts: true }));
  }, []);

  const replay = useRef<Replay | null>(null);
  const push = useRef<LivePush | null>(null);
  const tfRef = useRef(tf); tfRef.current = tf;
  const untilRef = useRef(until); untilRef.current = until;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const pickRef = useRef(pick); pickRef.current = pick;
  const autoPauseRef = useRef(autoPause); autoPauseRef.current = autoPause;
  const feedbackRef = useRef(feedback); feedbackRef.current = feedback;
  const ticketRef = useRef(ticketDefaults); ticketRef.current = ticketDefaults;
  const tool = useRef<DrawingKind | null>(null);
  const lines = useRef<TradeLines | null>(null);
  const boxes = useRef<SessionBoxes | null>(null);
  const paths = useRef<TradePaths | null>(null);
  const control = useRef<MarketChartControl | null>(null);
  const dragging = useRef<LineIntent | null>(null);
  const savedView = useRef<SavedView | null>(null);
  const chartSink = useRef<QuoteSink | null>(null);
  const stripSink = useRef<QuoteSink | null>(null);
  const pickLabel = useRef<HTMLSpanElement>(null);
  const pickLayer = useRef<{ current: () => PickedCandle | null } | null>(null);
  const lastUi = useRef(0);
  const allDrawings = useRef<Drawing[]>(session.drawings);
  const times = useRef<Record<string, number>>({ ...session.drawingTimes });
  const sounds = useRef<ReturnType<typeof createSounds> | null>(null);
  const highNews = useRef<{ at: number; title: string }[]>([]);

  const clockSec = () => Math.floor((replay.current?.clock ?? session.clockAt) / 1000);
  const toast = useCallback((text: string, tone: ToastTone = "info") => {
    if (tone === "error" || feedbackRef.current.toasts) toasts.push(text, tone);
  }, [toasts]);
  const sound = (k: SoundKind) => { if (feedbackRef.current.sounds) sounds.current?.play(k); };

  // Sound needs a first touch or key before the browser allows it.
  useEffect(() => {
    sounds.current = createSounds();
    const unlock = () => sounds.current?.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      sounds.current?.dispose();
    };
  }, []);

  const saver = useSaver(session.id, session.version, session.eventSeq, () => ({
    state: replay.current!.broker.snapshot(), clockSec: clockSec(),
  }));

  /* ---------------------------------------------------------- saving the view */

  const viewTimer = useRef(0);
  const saveView = useCallback((now = false) => {
    window.clearTimeout(viewTimer.current);
    const go = () => {
      void saveSessionView(session.id, { clockAt: clockSec(), timeframe: tfRef.current.key, chart: prefsRef.current });
    };
    if (now) go(); else viewTimer.current = window.setTimeout(go, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /* ------------------------------------------------------------ the account */

  const act = useCallback((a: SimAction): string | null => {
    const r = replay.current;
    if (!r) return "Not ready yet.";
    const res = r.act(a);
    if (!res.ok) { sound("error"); return res.error; }
    saver.action(r.clock, a);
    linked.reconcileSoon();
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver]);

  const linked = useLinkedPositions({
    replay,
    links: prefs.links ?? {},
    setLinks: (links: Record<string, BtLink>) => {
      const next = { ...prefsRef.current, links };
      prefsRef.current = next;
      setPrefs(next);
      saveView();
    },
    act,
    toast,
    prefill: () => {
      const r = replay.current;
      return {
        accountSize: Math.round(r?.broker.equity() ?? session.settings.balance),
        riskPercent: ticketRef.current.riskPct, lotSize: session.settings.contractSize,
        qtyPrecision: "2", leverage: session.settings.leverage,
      };
    },
    candleTime: (ms) => tfRef.current.bucket(Math.floor(ms / 1000)),
  });

  /* -------------------------------------------------------- the replay */

  const frame = useRef<() => void>(() => undefined);
  const onSim = useRef<(ev: SimEvent[]) => void>(() => undefined);
  const onPause = useRef<(reason: PauseReason) => void>(() => undefined);

  useEffect(() => {
    const r = new Replay(session.symbol, session.settings, session.state, session.clockAt, {
      onFrame: () => frame.current(),
      onSim: (ev) => onSim.current(ev),
      onStatus: (s) => setStatus(s),
      onPause: (reason) => onPause.current(reason),
    });
    r.pausePolicy = {
      event: (e) => pauseForEvent(e, autoPauseRef.current),
      point: (after, upto) => {
        const ap = autoPauseRef.current;
        if (!ap.news && !ap.sessions) return null;
        return nextPausePoint(after, upto, { news: ap.news ? highNews.current : [], leadSec: ap.newsLeadSec, sessions: ap.sessions ? SESSIONS : [] });
      },
    };
    replay.current = r;
    r.speed = speed;
    void r.init().then(() => {
      setUntil(barSpan(tfRef.current, Math.floor(r.clock / 1000)).start);
      if (startInPick) { enterPick(true); router.replace(`/backtest/s/${session.id}`, { scroll: false }); }
    });
    return () => r.destroy();
    // One replay for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastChart = useRef(0);
  const chartGap = useRef(50);
  const lastReconcile = useRef(0);
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
    if (u !== null && push.current && !pickRef.current) {
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
    const { bid, ask } = r.prices;
    const sp = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null;
    chartSink.current?.set(bid, ask, sp);
    stripSink.current?.set(bid, ask, sp);
    // Trailing stops move without an action: keep linked drawings with them.
    if (r.playing && now - lastReconcile.current > 500) { lastReconcile.current = now; linked.reconcile(); }
    if (!r.playing || now - lastUi.current > 150) { lastUi.current = now; setTick((t) => t + 1); }
  };

  /** Set when the replay just stopped on a fill or a close: that event's own message says so. */
  const pausedNote = useRef("");
  onSim.current = (ev) => {
    const r = replay.current;
    const pre = pausedNote.current;
    pausedNote.current = "";
    const ideas = ev.flatMap((e) => (e.kind === "idea" ? [e.idea] : []));
    if (ideas.length) {
      setTrades((ts) => {
        const known = new Set(ts.map((t) => t.ideaId));
        return ts.concat(ideas.filter((i) => !known.has(i.id)).map(ideaToTrade));
      });
      saver.finished(ideas);
    }
    linked.onSim(ev);
    // What happened, said once.
    let closed = false, filled = false;
    for (const e of ev) {
      if (e.kind === "fill") {
        filled = true;
        const what = e.from === "market" ? (e.side === "buy" ? "Bought" : "Sold") : `${e.side === "buy" ? "Buy" : "Sell"} ${e.from} filled:`;
        if (pre) toasts.push(`${pre}${what} ${e.lots.toFixed(2)} at ${e.price.toFixed(decimals)}`);
        else toast(`${what} ${e.lots.toFixed(2)} at ${e.price.toFixed(decimals)}`);
      } else if (e.kind === "close") {
        closed = true;
        const idea = ideas.find((i) => i.id === e.ideaId);
        if (idea) {
          const tone: ToastTone = idea.pnl >= 0 ? "win" : "loss";
          const text = `${pre}Closed · ${signed(idea.pnl)}${idea.r !== null ? ` · ${fmtR(idea.r)}` : ""}${e.reason === "user" ? "" : ` · ${REASON[e.reason] ?? ""}`}`;
          if (pre) toasts.push(text, tone); else toast(text, tone);
        } else if (r?.broker.state.positions.some((p) => p.id === e.positionId)) {
          toast(`Closed ${e.lots.toFixed(2)} at ${e.price.toFixed(decimals)} · ${signed(e.profit)}`, e.profit >= 0 ? "win" : "loss");
        }
      }
    }
    if (closed) sound("close"); else if (filled) sound("fill");
  };

  onPause.current = (reason) => {
    sound("pause");
    // A fill or a close is announced by its own message, marked as the reason for the pause.
    if (reason.kind === "fill" || reason.kind === "close") pausedNote.current = "Paused · ";
    else toasts.push(reason.kind === "news" ? `Paused — ${reason.title} in ${Math.round(autoPauseRef.current.newsLeadSec / 60)} min` : `Paused — ${reason.label} opens`);
    saveView();
  };

  const onLive = useCallback((p: LivePush | null) => {
    push.current = p;
    if (p) frame.current();
  }, []);

  const setSpeed = (x: number) => { setSpeedState(x); write("logr.bt.speed.v2", { v: x }); if (replay.current) replay.current.speed = x; };

  const togglePlay = () => {
    const r = replay.current;
    if (!r || pickRef.current) return;
    if (r.playing) { r.pause(); saveView(); } else r.play();
  };

  const step = async (to: "bar" | "minute") => {
    const r = replay.current;
    if (!r || r.playing || pickRef.current) return;
    const target = to === "bar" ? stepBar(tfRef.current, Math.floor(r.clock / 1000)) * 1000 : Math.floor(r.clock / 60_000) * 60_000 + 60_000;
    await r.advance(target);
    saveView();
  };

  const flat = () => {
    const s = replay.current?.broker.state;
    return !s || (s.positions.length === 0 && s.orders.length === 0);
  };

  const jumpTo = async (ms: number) => {
    const r = replay.current;
    if (!r) return;
    setSheet(null);
    const err = await r.jump(ms);
    if (err) { toast(err, "error"); return; }
    // Somewhere else in time: open on its newest candles, at the same zoom.
    setViewReq({ kind: "latest" });
    setUntil(barSpan(tfRef.current, Math.floor(r.clock / 1000)).start);
    refreshDrawings();
    saveView(true);
  };

  // While playing, where the replay has got to is saved every few seconds.
  useEffect(() => {
    if (!status.playing) return;
    const t = window.setInterval(() => saveView(true), 5000);
    return () => window.clearInterval(t);
  }, [status.playing, saveView]);
  useEffect(() => () => { void saveSessionView(session.id, { clockAt: clockSec(), timeframe: tfRef.current.key, chart: prefsRef.current }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  /* ------------------------------------------------------------ trading */

  const trade = useCallback((side: Side) => {
    const err = act({ kind: "market", side, lots: ticketRef.current.lots });
    if (err) toast(err, "error");
  }, [act, toast]);

  const setLots = useCallback((lots: number) => {
    setTicketDefaults((d) => { const n = { ...d, lots }; write("logr.bt.ticket", n); return n; });
  }, []);

  const breakevenAll = () => {
    const r = replay.current;
    if (!r) return;
    const ps = r.broker.state.positions;
    if (!ps.length) return toast("No open positions.");
    let moved = 0;
    for (const p of [...ps]) if (!act({ kind: "breakeven", id: p.id })) moved++;
    toast(moved === ps.length ? `Moved ${moved === 1 ? "the stop" : `all ${moved} stops`} to breakeven.`
      : `${moved} of ${ps.length} moved to breakeven; the rest aren't in profit yet.`);
  };

  const selectTf = (t: Timeframe) => {
    setTf(t);
    if (!pickRef.current) setUntil(barSpan(t, clockSec()).start);
    saveView();
  };

  const changePrefs = (p: BtChartPrefs) => { setPrefs(p); prefsRef.current = p; saveView(); };

  /* --------------------------------------------------------- drawings */

  /**
   * The drawing kit started (or stopped). Its layer is added after the trade
   * lines', so it would paint over them; the trade lines are put back on top —
   * a position's label and buttons must never be hidden under a drawing.
   */
  const onDrawingApi = useCallback((a: Parameters<typeof linked.onApi>[0]) => {
    linked.onApi(a);
    const tl = lines.current;
    if (a && tl && handle) {
      try { handle.series.detachPrimitive(tl); handle.series.attachPrimitive(tl); } catch { /* chart going */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

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

  /** The Long/Short Position tool, turned into a real order that stays tied to the drawing. */
  const placeFromPosition = (d: Drawing) => {
    const r = replay.current;
    const p0 = d.points[0];
    if (!r || !p0) return;
    const side: Side = d.kind === "long-position" ? "buy" : "sell";
    const st = d.style as { stopLevel?: number; profitLevel?: number };
    const stopD = st.stopLevel ?? 0, profitD = st.profitLevel ?? 0;
    if (!(stopD > 0)) { toast("Give the drawing a stop first: drag its red edge.", "error"); return; }
    const entry = Math.round(p0.price * 100) / 100;
    const sl = Math.round((side === "buy" ? entry - stopD : entry + stopD) * 100) / 100;
    const tp = profitD > 0 ? Math.round((side === "buy" ? entry + profitD : entry - profitD) * 100) / 100 : null;
    const { bid, ask } = r.prices;
    // The Qty the drawing shows is the Qty placed.
    const lots = r.broker.lotsForRisk(riskMoneyOf(d.style, r.broker.equity()), entry, sl);
    if (!(lots >= r.broker.settings.minLot)) { toast("That risk is less than the smallest size at this stop distance.", "error"); return; }
    const market = side === "buy" ? ask : bid;
    const a: SimAction = Math.abs(entry - market) <= 0.3
      ? { kind: "market", side, lots, sl, tp }
      : { kind: "pending", side, type: side === "buy" ? (entry < ask ? "limit" : "stop") : (entry > bid ? "limit" : "stop"), price: entry, lots, sl, tp };
    const res = r.act(a);
    if (!res.ok) { sound("error"); toast(res.error, "error"); return; }
    saver.action(r.clock, a);
    const id = res.ids[0];
    const s = r.broker.state;
    const ideaId = s.positions.find((x) => x.id === id)?.ideaId ?? s.orders.find((x) => x.id === id)?.ideaId ?? id;
    linked.link(d.id, { orderId: id, ideaId, side });
    // Its stop and target are the drawing's edges from now on.
    drawLines();
    saveView(true);
    if (a.kind === "pending") toast(`${side === "buy" ? "Buy" : "Sell"} ${a.type} placed at ${entry.toFixed(2)} · ${lots.toFixed(2)} lots, linked to the drawing.`);
  };

  /* ----------------------------------------------- lines and boxes on the chart */

  function drawLines() {
    const r = replay.current, tl = lines.current;
    if (!r || !tl) return;
    if (pickRef.current) { tl.set([]); tl.setCountdown(null); return; }
    const s = r.broker.state, contract = r.broker.settings.contractSize;
    const drag = dragging.current;
    const out: TradeLine[] = [];
    // How far from the entry, in price — the same on every account, however MT5 counts its points.
    const away = (px: number, from: number) => `${Math.abs(px - from).toFixed(decimals)} ${px < from ? "below" : "above"}`;

    for (const p of s.positions) {
      const buy = p.side === "buy";
      const pnl = r.broker.floating(p) + p.commission + p.swap;
      const risk = r.broker.positionRisk(p);
      const plAt = (px: number) => (buy ? px - p.openPrice : p.openPrice - px) * p.lots * contract;
      const drawn = linked.drawsTrade(p.id);
      const canBe = buy ? s.bid > p.openPrice && (p.sl === null || p.sl < p.openPrice) : s.ask < p.openPrice && (p.sl === null || p.sl > p.openPrice);
      const tabs: LineTab[] = [];
      if (p.sl === null) tabs.push({ key: "sl", text: "SL", title: "Drag out a stop-loss" });
      if (p.tp === null) tabs.push({ key: "tp", text: "TP", title: "Drag out a take-profit" });
      if (canBe) tabs.push({ key: "be", text: "BE", title: "Move the stop to breakeven" });
      tabs.push({ key: "close", text: "×", title: "Close the position" });
      out.push({
        id: `${p.id}:entry`, obj: p.id, role: "entry", side: p.side, price: p.openPrice,
        label: `${buy ? "BUY" : "SELL"} ${p.lots.toFixed(2)}  ${signed(pnl)}${risk ? `  ${fmtR(pnl / risk)}` : ""}`,
        color: buy ? BUY : SELL, draggable: false, axis: true, tabs,
      });
      for (const role of ["sl", "tp"] as const) {
        const level = p[role];
        const preview = drag && drag.obj === p.id && drag.role === role ? drag.price : null;
        const px = preview ?? level;
        if (px === null || (drawn && preview === null)) continue;
        const pl = plAt(px);
        const firstStop = role === "sl" && risk === null;
        const extra = risk ? ` · ${fmtR(pl / risk)}` : ` · ${away(px, p.openPrice)}`;
        out.push({
          id: `${p.id}:${role}`, obj: p.id, role: level === null ? "ghost" : role, side: p.side, price: px,
          label: `${role.toUpperCase()}  ${signed(pl)}${extra}${preview !== null && firstStop ? " · sets the risk" : ""}`,
          color: role === "sl" ? SL : TP, dashed: true, draggable: level !== null, axis: true,
          tabs: level !== null && preview === null ? [{ key: "remove", text: "×", title: `Remove the ${role === "sl" ? "stop-loss" : "take-profit"}` }] : undefined,
        });
      }
    }

    for (const o of s.orders) {
      const buy = o.side === "buy";
      const drawn = linked.drawsTrade(o.id);
      const price = drag && drag.obj === o.id && drag.role === "price" ? drag.price : o.price;
      const tabs: LineTab[] = [];
      if (o.sl === null) tabs.push({ key: "sl", text: "SL", title: "Drag out a stop-loss" });
      if (o.tp === null) tabs.push({ key: "tp", text: "TP", title: "Drag out a take-profit" });
      tabs.push({ key: "cancel", text: "×", title: "Cancel the order" });
      out.push({
        id: `${o.id}:order`, obj: o.id, role: "order", side: o.side, price,
        label: `${buy ? "BUY" : "SELL"} ${o.type.toUpperCase()} ${o.lots.toFixed(2)}`,
        color: ORDER, dashed: true, draggable: true, axis: true, tabs,
      });
      const plAt = (px: number) => (buy ? px - o.price : o.price - px) * o.lots * contract;
      for (const role of ["sl", "tp"] as const) {
        const level = o[role];
        const preview = drag && drag.obj === o.id && drag.role === role ? drag.price : null;
        const px = preview ?? level;
        if (px === null || (drawn && preview === null)) continue;
        out.push({
          id: `${o.id}:${role}`, obj: o.id, role: level === null ? "ghost" : role, side: o.side, price: px,
          label: `${role.toUpperCase()}  ${signed(plAt(px))} · ${away(px, o.price)}`,
          color: role === "sl" ? SL : TP, dashed: true, draggable: level !== null,
          tabs: level !== null && preview === null ? [{ key: "remove", text: "×", title: `Remove the ${role === "sl" ? "stop-loss" : "take-profit"}` }] : undefined,
        });
      }
    }

    if (prefsRef.current.askLine && Number.isFinite(s.ask)) {
      out.push({ id: "ask", obj: "", role: "ask", price: s.ask, label: "", color: ASK, dotted: true, draggable: false, axis: true, bare: true });
    }
    tl.set(out);
    if (prefsRef.current.countdown && Number.isFinite(s.bid)) {
      const now = clockSec();
      const left = Math.max(0, barSpan(tfRef.current, now).end - now);
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
      const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
      tl.setCountdown({ price: s.bid, text });
    } else tl.setCountdown(null);
  }

  /** A level set by dragging, or typed in. */
  const commitLevel = (p: LineIntent) => {
    const a: SimAction = p.role === "price" ? { kind: "modify", id: p.obj, price: p.price } : { kind: "modify", id: p.obj, [p.role]: p.price };
    const err = act(a);
    if (err) toast(err, "error");
  };

  const lineAction = (line: TradeLine, key: "be" | "close" | "remove" | "cancel") => {
    const a: SimAction = key === "close" ? { kind: "close", id: line.obj }
      : key === "be" ? { kind: "breakeven", id: line.obj }
      : key === "cancel" ? { kind: "cancel", id: line.obj }
      : { kind: "modify", id: line.obj, [line.role === "tp" ? "tp" : "sl"]: null };
    const err = act(a);
    if (err) toast(err, "error");
  };

  useEffect(() => {
    if (!handle) return;
    const css = getComputedStyle(document.documentElement);
    const font = css.getPropertyValue("--font-sans").trim() || "sans-serif";
    const coarse = matchMedia("(pointer: coarse)").matches;
    const tl = new TradeLines(font, decimals, coarse);
    const sb = new SessionBoxes(font);
    const tp = new TradePaths({ win: css.getPropertyValue("--profit").trim() || "#089981", loss: css.getPropertyValue("--loss").trim() || "#f23645" });
    handle.series.attachPrimitive(sb);
    handle.series.attachPrimitive(tp);
    handle.series.attachPrimitive(tl);
    lines.current = tl;
    boxes.current = sb;
    paths.current = tp;
    sb.configure(prefsRef.current.sessions, tfRef.current.seconds);
    const detach = attachLineInteraction(handle, tl, {
      priceStep: 0.01,
      busy: () => tool.current !== null || pickRef.current,
      yieldTo: () => !!linked.api.current?.dm.hoveredId(),
      market: () => replay.current?.prices ?? { bid: NaN, ask: NaN },
      onPreview: (p) => { dragging.current = p; drawLines(); },
      onCommit: (p) => { dragging.current = null; commitLevel(p); drawLines(); },
      onAction: (line, key) => lineAction(line, key),
      onEdit: (line, field, at) => setEditor({ line, field, at }),
    });
    drawLines();
    setTradePaths();
    let gone = false;
    const off = () => {
      if (gone) return;
      gone = true;
      detach();
      try { handle.series.detachPrimitive(tl); handle.series.detachPrimitive(tp); handle.series.detachPrimitive(sb); } catch { /* chart already gone */ }
      if (lines.current === tl) lines.current = null;
      if (boxes.current === sb) boxes.current = null;
      if (paths.current === tp) paths.current = null;
    };
    const unregister = handle.onDispose(off);
    return () => { unregister(); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, decimals]);

  useEffect(() => { boxes.current?.configure(prefs.sessions, tf.seconds); }, [prefs.sessions, tf.seconds]);

  /** Dotted entry→exit lines for the finished trades up to the clock. */
  function setTradePaths() {
    const tp = paths.current;
    if (!tp) return;
    const p = prefsRef.current;
    if (!p.tradePaths || pickRef.current) { tp.set([]); return; }
    const now = replay.current?.clock ?? session.clockAt;
    const b = (ms: number) => tfRef.current.bucket(Math.floor(ms / 1000));
    tp.set(trades.flatMap((t) => t.legs
      .filter((l) => l.closedAt <= now)
      .map((l) => ({ id: t.id, t0: b(l.openedAt), p0: l.openPrice, t1: b(l.closedAt), p1: l.closePrice, win: l.profit + l.commission + l.swap >= 0 }))));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTradePaths(); }, [trades, tf, prefs.tradePaths, pick, drawKey]);

  /* ------------------------------------------------------------- news */

  const nowSec = clockSec();
  useEffect(() => {
    if (prefs.news === "off" && !autoPause.news) return;
    if (nowSec >= news.from && nowSec <= news.to - 7 * 86_400) return;
    const from = nowSec - 14 * 86_400, to = nowSec + 30 * 86_400;
    let live = true;
    fetch(`/api/news/events?from=${from}&to=${to}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j: { events: NewsItem[] }) => { if (live) setNews({ from, to, items: j.events }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [Math.floor(nowSec / 86_400), prefs.news, autoPause.news]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    highNews.current = news.items.filter((n) => n.impact === "high").map((n) => ({ at: n.at, title: `${n.currency} ${n.title}` })).sort((a, b) => a.at - b.at);
  }, [news]);

  /* ---------------------------------------------------------- markers */

  const r = replay.current;
  const clockMs = r?.clock ?? session.clockAt;
  const positionsKey = r ? r.broker.state.positions.map((p) => p.id).join(",") : "";
  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    if (pick) return [];
    const out: SeriesMarker<Time>[] = [];
    const b = (ms: number) => tf.bucket(Math.floor(ms / 1000)) as Time;
    for (const t of trades) {
      for (const l of t.legs) {
        // Trades from later in replay time (after a jump back) stay off the chart.
        if (l.closedAt > clockMs) continue;
        out.push({ time: b(l.openedAt), position: "atPriceMiddle", price: l.openPrice, shape: l.direction === "long" ? "arrowUp" : "arrowDown", color: l.direction === "long" ? BUY : SELL, size: 1 });
        out.push({ time: b(l.closedAt), position: "atPriceMiddle", price: l.closePrice, shape: "circle", color: l.profit + l.commission + l.swap >= 0 ? TP : SELL, size: 0.8 });
      }
    }
    for (const p of replay.current?.broker.state.positions ?? []) {
      out.push({ time: b(p.openTime), position: "atPriceMiddle", price: p.openPrice, shape: p.side === "buy" ? "arrowUp" : "arrowDown", color: p.side === "buy" ? BUY : SELL, size: 1 });
    }
    if (prefs.news !== "off") {
      for (const n of news.items) {
        if (n.at > nowSec) continue;
        if (n.impact !== "high" && !(prefs.news === "medium" && n.impact === "medium")) continue;
        out.push({ time: tf.bucket(n.at) as Time, position: "aboveBar", shape: "square", color: n.impact === "high" ? SELL : "#ff9800", size: 0.6, text: `${n.currency} ${n.title}`.slice(0, 22) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, tf, positionsKey, news, prefs.news, Math.floor(nowSec / 60), pick]);

  /* ------------------------------------------------------- picking the start */

  /** "Replay from…": the latest data on screen, a line to place, everything after it dimmed. */
  function enterPick(fromNew = false) {
    const r = replay.current;
    if (!r) return;
    if (!flat()) { toast("Close your trades and cancel your orders before picking a new start.", "error"); return; }
    r.pause();
    setSheet(null);
    setEditor(null);
    savedView.current = fromNew ? null : control.current?.view() ?? null;
    setViewReq({ kind: "latest" });
    setPick(true);
  }

  const cancelPick = () => {
    setViewReq(savedView.current ? { kind: "restore", view: savedView.current } : null);
    setPick(false);
  };

  const commitPick = async (c: PickedCandle) => {
    const r = replay.current;
    if (!r || !handle) return;
    const t = tfRef.current;
    // The picked candle is the last one shown; Play reveals the next.
    const ms = stepBar(t, c.time) * 1000;
    const first = !trades.length && saver.status === "idle" && (r.broker.state.positions.length + r.broker.state.orders.length === 0);
    const err = await r.jump(ms);
    if (err) { toast(err, "error"); return; }
    setViewReq({ kind: "anchor", time: c.time, x: c.x, barSpacing: handle.chart.timeScale().options().barSpacing });
    setPick(false);
    setUntil(barSpan(t, Math.floor(r.clock / 1000)).start);
    refreshDrawings();
    if (first) void saveSessionView(session.id, { clockAt: Math.floor(r.clock / 1000), startedAt: Math.floor(r.clock / 1000), timeframe: t.key, chart: prefsRef.current });
    else saveView(true);
    toast(`Replay starts ${pickFmt.format(new Date(c.time * 1000))}. Press play when ready.`);
  };

  const pickFmt = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }), [timeZone]);

  useEffect(() => {
    if (!handle || !pick) return;
    const css = getComputedStyle(document.documentElement);
    const coarse = matchMedia("(pointer: coarse)").matches;
    const plane = css.getPropertyValue("--plane").trim() || "#ffffff";
    const ov = new PickOverlay(`color-mix(in srgb, ${plane} 68%, transparent)`, css.getPropertyValue("--c1").trim() || "#2962ff", coarse);
    handle.series.attachPrimitive(ov);
    const layer = attachPickLayer(handle, ov, {
      coarse,
      candleAt: (x) => control.current?.candleAt(x) ?? null,
      label: (time) => pickFmt.format(new Date(time * 1000)),
      onChange: (c) => { if (pickLabel.current) pickLabel.current.textContent = c ? pickFmt.format(new Date(c.time * 1000)) : "—"; },
      onPick: (c) => void commitPick(c),
    });
    pickLayer.current = layer;
    return () => {
      layer.detach();
      pickLayer.current = null;
      try { handle.series.detachPrimitive(ov); } catch { /* chart gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, pick, pickFmt]);

  /* ---------------------------------------------------- history → chart */

  const showTrade = async (t: TradeProps) => {
    const r = replay.current;
    if (!r) return;
    if (t.openedAt > r.clock) { toast("That trade is later in the replay than now."); return; }
    setSheet(null);
    const res = await control.current?.focus(Math.floor(t.openedAt / 1000));
    if (res === "shown") paths.current?.highlight(t.id, 2000);
    else toast("That part of the history isn't on the chart.");
  };

  /* --------------------------------------------------------- keyboard */

  useShortcuts((a: ShortcutAction) => {
    if (a === "escape") {
      if (editor) setEditor(null);
      else if (pickRef.current) cancelPick();
      return;
    }
    if (a === "help") { setSheet((s) => (s === "keys" ? null : "keys")); return; }
    if (a === "play") togglePlay();
    else if (a === "step") void step("bar");
    else if (a === "stepMinute") void step("minute");
    else if (a === "faster" || a === "slower") {
      const i = SPEEDS.findIndex((s) => s.x === speed);
      const n = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 4 : i) + (a === "faster" ? 1 : -1)))];
      setSpeed(n.x);
      toast(`Speed ${n.label}`);
    } else if (a === "buy" || a === "sell") trade(a);
    else if (a === "closeAll") {
      if (!replay.current?.broker.state.positions.length) toast("No open positions.");
      else { const err = act({ kind: "closeAll" }); if (err) toast(err, "error"); }
    } else if (a === "breakeven") breakevenAll();
  }, () => ({
    typingOk: sheet === null && editor === null,
    trading: tool.current === null && !pickRef.current && sheet === null && editor === null,
  }));

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
  const frozenCount = Object.values(prefs.links ?? {}).filter((l) => l.frozen).length;
  const canTrade = !!broker && Number.isFinite(prices.bid) && !status.loading && !pick;

  const panels = (p: Panel) => !broker ? null : p === "trade"
    ? (
      <div className="space-y-3">
        <Ticket broker={broker} bid={prices.bid} ask={prices.ask} defaults={ticketDefaults}
                onDefaults={(d) => { setTicketDefaults(d); write("logr.bt.ticket", d); }} onPlace={act} />
        <Info title="Trading on the chart">
          The Sell and Buy buttons on the chart fill at once, with no stop needed. Then drag out from the entry
          line&apos;s label — down for a stop, up for a target on a buy — or use its SL and TP buttons. Double-click any
          label to type an exact price. Shift+B and Shift+S buy and sell from the keyboard; press ? for the rest.
        </Info>
      </div>
    )
    : p === "positions" ? <Positions broker={broker} onAct={act} />
    : p === "history" ? <History trades={trades} timeZone={timeZone} clock={clockMs} onSelect={(t) => void showTrade(t)} />
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
          <div className="num truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{pick ? "Picking where to start" : clockText.format(new Date(clockMs))}</div>
        </div>
        <span className="hidden text-[11.5px] sm:inline" style={{ color: saver.status === "error" ? "var(--loss)" : "var(--ink3)" }}>{saveText}</span>
        <button type="button" onClick={() => setSheet("keys")} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"
                className="hidden h-8 w-8 place-items-center rounded-lg text-[13px] font-bold lg:grid" style={{ background: "var(--s3)" }}>?</button>
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
          {handle && !pick && (
            <div className={`px-3 pb-1.5 ${drawOpen ? "" : "hidden lg:block"}`}>
              <DrawingSystem key={drawKey} handle={handle} initial={visibleDrawings()} onSave={saveDrawings}
                             presets={labelPresets} interval={kitInterval(tf.key)} timeZone={timeZone} decimals={decimals}
                             pageScroll={false} onTool={(k) => { tool.current = k; }} onApi={onDrawingApi}
                             selectionActions={(d) => {
                               if (d.kind !== "long-position" && d.kind !== "short-position") return null;
                               const l = prefs.links?.[d.id];
                               if (l?.frozen) return <span className="px-1 text-[12px]" style={{ color: "var(--ink3)" }}>Closed trade</span>;
                               if (l && !l.detached) {
                                 return (
                                   <span className="flex items-center gap-1.5">
                                     <span className="rounded-md px-2 py-1 text-[11.5px] font-semibold" style={{ background: "var(--s3)", color: "var(--ink2)" }}>Linked to the order</span>
                                     <button type="button" onClick={() => linked.unlink(d.id)} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold" style={{ background: "var(--s3)" }}>Unlink</button>
                                   </span>
                                 );
                               }
                               return (
                                 <button type="button" onClick={() => placeFromPosition(d)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-white"
                                         style={{ background: d.kind === "long-position" ? BUY : SELL }}>Place order</button>
                               );
                             }} />
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {until !== null && (
              <MarketChart symbol={session.symbol} tf={tf} timeZone={timeZone} decimals={decimals} fill
                           until={pick ? undefined : until} onLive={onLive} onReady={setHandle} onControl={(c) => { control.current = c; }}
                           viewOnOpen={viewReq}
                           type={prefs.type} volume={prefs.volume} indicators={prefs.indicators} markers={markers} />
            )}
            {broker && !pick && (
              <div className="pointer-events-none absolute left-1.5 top-7 z-[6] hidden lg:block">
                <OneClick layout="chart" lots={ticketDefaults.lots} lotStep={session.settings.lotStep} minLot={session.settings.minLot}
                          decimals={decimals} disabled={!canTrade} onLots={setLots} onTrade={trade} sink={chartSink} />
              </div>
            )}
            {pick && (
              <div className="pointer-events-none absolute inset-x-0 top-8 z-[8] flex justify-center px-3">
                <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] shadow-lg"
                     style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
                  <span style={{ color: "var(--ink3)" }}>Start at</span>
                  <span ref={pickLabel} className="num font-semibold">—</span>
                  <button type="button" className="btn btn-primary !py-1 !text-[12.5px]" onClick={() => { const c = pickLayer.current?.current(); if (c) void commitPick(c); }}>Start here</button>
                  <button type="button" className="btn btn-ghost !py-1 !text-[12.5px]" onClick={cancelPick}>Cancel</button>
                </div>
              </div>
            )}
            {status.loading && (
              <div className="pointer-events-none absolute left-1/2 top-12 z-[7] -translate-x-1/2 rounded-full px-3 py-1 text-[12px] font-medium"
                   style={{ background: "var(--s1)", boxShadow: "0 2px 10px rgb(0 0 0 / 0.18)" }}>{status.loading}</div>
            )}
            <Toasts items={toasts.items} />
          </div>

          {/* Replay controls */}
          <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderTop: "1px solid var(--line)" }}>
            <button type="button" onClick={() => setSheet("jump")} disabled={pick} className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-40" style={{ background: "var(--s3)" }}>Go to</button>
            <button type="button" onClick={() => (pick ? cancelPick() : enterPick())} title="Pick where the replay starts, on the chart"
                    className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[12.5px] font-semibold" style={pick ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)" }}>
              {pick ? "Cancel" : <><span className="sm:hidden">Start…</span><span className="hidden sm:inline">Replay from…</span></>}
            </button>
            <button type="button" onClick={togglePlay} disabled={pick} aria-label={status.playing ? "Pause" : "Play"} title="Play / pause (space)"
                    className="flex h-9 w-11 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ background: "var(--c1)" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">
                {status.playing ? <path d="M3 2h3v10H3zM8 2h3v10H8z" /> : <path d="M3 1.5v11l9-5.5z" />}
              </svg>
            </button>
            <button type="button" onClick={() => void step("bar")} disabled={status.playing || pick} title="Step one candle (→)" aria-label="Step one candle"
                    className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-40" style={{ background: "var(--s3)" }}>
              +1<span className="hidden sm:inline"> candle</span>
            </button>
            <button type="button" onClick={() => void step("minute")} disabled={status.playing || pick} title="Step one minute (shift →)" className="hidden rounded-lg px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-40 sm:block" style={{ background: "var(--s3)" }}>
              +1 min
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink3)" }}>
              <span className="hidden sm:inline">Speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed"
                      className="h-9 max-w-[104px] rounded-lg px-2 text-[12.5px] sm:max-w-none" style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                {SPEEDS.map((s) => <option key={s.x} value={s.x}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {/* Phones and tablets: one-click trading above the account. */}
          {broker && (
            <div className="space-y-1.5 px-3 pb-1.5 lg:hidden">
              {!pick && (
                <OneClick layout="strip" lots={ticketDefaults.lots} lotStep={session.settings.lotStep} minLot={session.settings.minLot}
                          decimals={decimals} disabled={!canTrade} onLots={setLots} onTrade={trade} sink={stripSink} />
              )}
              <div className="grid grid-cols-4 gap-1.5">
                {([["trade", "Ticket"], ...tabs.slice(1)] as [Panel, string][]).map(([k, l]) => (
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

      {editor && broker && (
        <LevelEditor editor={editor} broker={broker} decimals={decimals} onClose={() => setEditor(null)} act={act} />
      )}

      {/* Sheets */}
      {sheet && (
        <Sheet title={sheet === "jump" ? "Go to" : sheet === "chart" ? "Chart" : sheet === "keys" ? "Keyboard shortcuts" : sheet === "trade" ? "Ticket" : tabs.find(([k]) => k === sheet)?.[1] ?? ""} onClose={() => setSheet(null)}>
          {sheet === "jump" ? (
            <JumpPanel timeZone={timeZone} range={session.range} clock={clockMs} news={news.items} flat={flat()}
                       onJump={jumpTo} onPick={() => enterPick()} onError={(m) => toast(m, "error")} />
          ) : sheet === "chart" ? (
            <ChartOptions prefs={prefs} onChange={changePrefs}
                          autoPause={autoPause} onAutoPause={(a) => { setAutoPause(a); write("logr.bt.autopause", a); }}
                          feedback={feedback} onFeedback={(f) => { setFeedback(f); write("logr.bt.feedback", f); }}
                          frozenCount={frozenCount} onRemoveFrozen={() => { linked.removeFrozen(); toast("Removed the closed trades' drawings."); }} />
          ) : sheet === "keys" ? <ShortcutsList /> : panels(sheet)}
        </Sheet>
      )}
    </div>
  );
}

/** Typing an exact price for a stop, a target or an order (double-click a line's label). */
function LevelEditor({ editor, broker, decimals, onClose, act }: {
  editor: { line: TradeLine; field: "sl" | "tp" | "price" | "all"; at: { x: number; y: number } };
  broker: NonNullable<Replay["broker"]>;
  decimals: number;
  onClose: () => void;
  act: (a: SimAction) => string | null;
}) {
  const s = broker.state;
  const id = editor.line.obj;
  const pos: OpenPosition | undefined = s.positions.find((p) => p.id === id);
  const ord: PendingOrder | undefined = s.orders.find((o) => o.id === id);
  const item = pos ?? ord;
  useEffect(() => { if (!item) onClose(); }, [item, onClose]);
  if (!item) return null;
  const buy = item.side === "buy";
  const ref = pos ? pos.openPrice : ord!.price;
  const lots = item.lots, contract = broker.settings.contractSize;
  const risk = pos ? broker.positionRisk(pos) : null;
  const all = editor.field === "all";
  const fields: PriceField[] = [];
  if (ord && (all || editor.field === "price")) fields.push({ key: "price", label: "Order price", value: ord.price });
  if (all || editor.field === "sl") fields.push({ key: "sl", label: "Stop-loss", value: item.sl });
  if (all || editor.field === "tp") fields.push({ key: "tp", label: "Take-profit", value: item.tp });
  const title = `${buy ? "Buy" : "Sell"}${ord ? ` ${ord.type}` : ""} ${lots.toFixed(2)} @ ${ref.toFixed(decimals)}`;
  return (
    <PriceEditor at={editor.at} title={title} fields={fields} decimals={decimals}
                 preview={(key: PriceKey, price: number) => {
                   if (key === "price") return null;
                   const pl = (buy ? price - ref : ref - price) * lots * contract;
                   const away = `${Math.abs(price - ref).toFixed(decimals)} ${price < ref ? "below" : "above"}`;
                   return `${signed(pl)} · ${away}${risk && key === "tp" ? ` · ${fmtR(pl / risk)}` : ""}`;
                 }}
                 onCommit={(v) => {
                   const err = act({ kind: "modify", id, ...v } as SimAction);
                   if (!err) onClose();
                   return err;
                 }}
                 onCancel={onClose} />
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

const readWhen = (): StartWhen => {
  try { const v = JSON.parse(localStorage.getItem("logr.bt.startWhen") ?? "null"); return START_WHEN.some((w) => w.key === v) ? v : "day"; } catch { return "day"; }
};

/** Where to go: pick on the chart, a date and time, a random day in a range, the next session open, the next news. */
function JumpPanel({ timeZone, range, clock, news, flat, onJump, onPick, onError }: {
  timeZone: string;
  range: { first: string; last: string } | null;
  clock: number;
  news: NewsItem[];
  flat: boolean;
  onJump: (ms: number) => void;
  onPick: () => void;
  onError: (m: string) => void;
}) {
  const local = useMemo(() => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
      .formatToParts(new Date(clock)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
  }, [clock, timeZone]);
  const [when, setWhen] = useState(local);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(range?.first ?? "");
  const [to, setTo] = useState(range?.last ?? "");
  const [startAt, setStartAt] = useState<StartWhen>("day");
  useEffect(() => { setStartAt(readWhen()); }, []);
  const sec = Math.floor(clock / 1000);
  const nextNews = news.find((n) => n.at > sec + 60 && n.impact === "high");
  const go = (s: number) => onJump(s * 1000);
  const field = "h-10 min-w-0 rounded-lg px-2.5 text-[13.5px]";
  const fieldStyle = { background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" } as const;

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-primary w-full !text-[13.5px]" disabled={!flat} onClick={onPick}
              title={flat ? "Opens the latest data with a line to click where the replay should begin" : "Close your trades and cancel your orders first"}>
        Replay from… (pick on the chart)
      </button>
      <div>
        <label className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ink3)" }}>Date and time (your clock)</label>
        <div className="flex gap-2">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                 min={range ? `${range.first}T00:00` : undefined} max={range ? `${range.last}T23:59` : undefined}
                 className={`${field} flex-1`} style={fieldStyle} />
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
        <button type="button" className="btn btn-secondary col-span-2 !text-[13px]" disabled={!nextNews} onClick={() => nextNews && go(nextNews.at - 120)}
                title={nextNews ? `${nextNews.currency} ${nextNews.title}` : "No high-impact release imported in the next month"}>
          Next big news{nextNews ? ` — ${nextNews.currency} ${nextNews.title}` : ""}
        </button>
      </div>
      <div className="space-y-2 rounded-xl p-3" style={{ background: "var(--s2)" }}>
        <div className="text-[13px] font-semibold">A random day</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={from} min={range?.first} max={range?.last} onChange={(e) => setFrom(e.target.value)} aria-label="Random from" className={field} style={fieldStyle} />
          <input type="date" value={to} min={range?.first} max={range?.last} onChange={(e) => setTo(e.target.value)} aria-label="Random to" className={field} style={fieldStyle} />
        </div>
        <select value={startAt} aria-label="Start at" className={`${field} w-full`} style={fieldStyle}
                onChange={(e) => { const v = e.target.value as StartWhen; setStartAt(v); write("logr.bt.startWhen", v); }}>
          {START_WHEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
        <button type="button" className="btn btn-secondary w-full !text-[13px]" disabled={busy || !flat} onClick={async () => {
          if (from && to && from > to) return onError("The range ends before it starts.");
          setBusy(true);
          const r = await randomDay(from || undefined, to || undefined);
          setBusy(false);
          if (!r.ok) return onError(r.error);
          go(startTimeFor(r.day, startAt));
        }} title={flat ? undefined : "Close your trades and cancel your orders first"}>{busy ? "Picking…" : "Go to a random day"}</button>
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

function Switch({ label, on, onClick, colour, hint }: { label: string; on: boolean; onClick: () => void; colour?: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-[13.5px]">
      {colour && <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />}
      <span className="flex-1">{label}{hint && <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{hint}</span>}</span>
      <span className="relative h-6 w-10 shrink-0 rounded-full" style={{ background: on ? "var(--c1)" : "var(--s3)", boxShadow: on ? undefined : "inset 0 0 0 1px var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-150" style={{ left: on ? 18 : 2, background: "#fff", boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)" }} />
      </span>
    </button>
  );
}

function ChartOptions({ prefs, onChange, autoPause, onAutoPause, feedback, onFeedback, frozenCount, onRemoveFrozen }: {
  prefs: BtChartPrefs;
  onChange: (p: BtChartPrefs) => void;
  autoPause: AutoPause;
  onAutoPause: (a: AutoPause) => void;
  feedback: Feedback;
  onFeedback: (f: Feedback) => void;
  frozenCount: number;
  onRemoveFrozen: () => void;
}) {
  const has = (id: string) => prefs.indicators.some((i) => i.id === id);
  const toggle = (spec: IndicatorSpec) => onChange({
    ...prefs, indicators: has(spec.id) ? prefs.indicators.filter((i) => i.id !== spec.id) : [...prefs.indicators, spec],
  });
  const heading = (t: string) => <div className="pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{t}</div>;
  return (
    <div className="space-y-0.5">
      <div className="seg mb-2 w-full" role="group" aria-label="Chart type">
        {(["candles", "line"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={prefs.type === t} onClick={() => onChange({ ...prefs, type: t })} className="flex-1 !py-1.5 !text-[12.5px]">{t === "candles" ? "Candles" : "Line (closes)"}</button>
        ))}
      </div>
      {PRESET_INDICATORS.map((s) => (
        <Switch key={s.id} label={s.kind === "vwap" ? "VWAP (daily)" : `${s.kind.toUpperCase()} ${s.period}`} colour={s.color} on={has(s.id)} onClick={() => toggle(s)} />
      ))}
      <Switch label="Volume" on={prefs.volume} onClick={() => onChange({ ...prefs, volume: !prefs.volume })} />
      <Switch label="Session boxes (Tokyo, London, New York)" on={prefs.sessions} onClick={() => onChange({ ...prefs, sessions: !prefs.sessions })} />
      <Switch label="Ask line" hint="The price a buy fills at. The candles are bid prices." on={prefs.askLine} onClick={() => onChange({ ...prefs, askLine: !prefs.askLine })} />
      <Switch label="Candle countdown" hint="Time left on the current candle, under the price." on={prefs.countdown} onClick={() => onChange({ ...prefs, countdown: !prefs.countdown })} />
      <Switch label="Trade lines" hint="A dotted line from each finished trade's entry to its exit." on={prefs.tradePaths} onClick={() => onChange({ ...prefs, tradePaths: !prefs.tradePaths })} />
      <div className="pt-2">
        <span className="mb-1 block text-[12px] font-medium" style={{ color: "var(--ink3)" }}>News on the chart</span>
        <div className="seg w-full" role="group" aria-label="News">
          {([["off", "Off"], ["high", "High impact"], ["medium", "High + medium"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={prefs.news === k} onClick={() => onChange({ ...prefs, news: k })} className="flex-1 !py-1.5 !text-[12px]">{l}</button>
          ))}
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>Releases come from the calendar imported under Import → News.</p>
      </div>

      {heading("Pause automatically")}
      <Switch label="When an order fills" on={autoPause.fills} onClick={() => onAutoPause({ ...autoPause, fills: !autoPause.fills })} />
      <Switch label="When a stop-loss or take-profit is hit" on={autoPause.stops} onClick={() => onAutoPause({ ...autoPause, stops: !autoPause.stops })} />
      <Switch label="Before high-impact news" hint={`${Math.round(autoPause.newsLeadSec / 60)} minutes before the release.`} on={autoPause.news} onClick={() => onAutoPause({ ...autoPause, news: !autoPause.news })} />
      {autoPause.news && (
        <div className="seg w-full" role="group" aria-label="How long before the news">
          {[60, 120, 300].map((s) => (
            <button key={s} type="button" aria-pressed={autoPause.newsLeadSec === s} onClick={() => onAutoPause({ ...autoPause, newsLeadSec: s })} className="flex-1 !py-1.5 !text-[12px]">{s / 60} min</button>
          ))}
        </div>
      )}
      <Switch label="At the Tokyo, London and New York opens" on={autoPause.sessions} onClick={() => onAutoPause({ ...autoPause, sessions: !autoPause.sessions })} />
      <Info title="Why pause automatically?">
        Playing fast, a fill or a stop being hit is over before the eye catches it. The replay stops on the exact tick
        it happened, so you see the moment and decide what to do next. Your own clicks never pause it.
      </Info>

      {heading("Feedback")}
      <Switch label="Sounds" hint="A tick for a fill, the same short sound for every close, a chime when it pauses." on={feedback.sounds} onClick={() => onFeedback({ ...feedback, sounds: !feedback.sounds })} />
      <Switch label="Messages" hint="A short note over the chart for fills and results." on={feedback.toasts} onClick={() => onFeedback({ ...feedback, toasts: !feedback.toasts })} />

      {frozenCount > 0 && (
        <div className="pt-3">
          <button type="button" className="btn btn-secondary w-full !text-[13px]" onClick={onRemoveFrozen}>
            Remove {frozenCount} closed-trade drawing{frozenCount === 1 ? "" : "s"}
          </button>
          {frozenCount >= 250 && <p className="mt-1 text-[11.5px]" style={{ color: "var(--warn)" }}>A chart holds up to 300 drawings; old position drawings are taking up room.</p>}
        </div>
      )}
    </div>
  );
}
