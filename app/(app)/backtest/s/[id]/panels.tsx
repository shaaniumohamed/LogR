"use client";

import { useMemo, useState } from "react";
import type { Broker, OpenPosition, PendingOrder, Side, SimAction } from "@/lib/core/sim/broker";
import { backtestStats } from "@/lib/core/backtest";
import { money, pct } from "@/components/ui";
import { toRow, type TradeProps } from "./model";

const num = (v: string) => { const n = Number(v.replace(",", ".")); return v.trim() === "" || !Number.isFinite(n) ? null : n; };
const fmt = (p: number, d = 2) => p.toFixed(d);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium" style={{ color: "var(--ink3)" }}>{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px]" style={{ color: "var(--ink3)" }}>{hint}</span>}
    </label>
  );
}

const inputCls = "num h-9 w-full rounded-lg px-2.5 text-[13.5px]";
const inputStyle = { background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" } as const;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg w-full" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className="flex-1 !px-2 !py-1.5 !text-[12.5px]">{l}</button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ ticket */

export interface TicketDefaults { lots: number; riskPct: number; sizeBy: "lots" | "risk" }

/**
 * The order ticket: market, limit, stop or a ladder, sized in lots or by the
 * share of the account risked to the stop, with the stop and target set here
 * or dragged on the chart afterwards.
 */
export function Ticket({ broker, bid, ask, defaults, onDefaults, onPlace }: {
  broker: Broker;
  bid: number;
  ask: number;
  defaults: TicketDefaults;
  onDefaults: (d: TicketDefaults) => void;
  onPlace: (a: SimAction) => string | null;
}) {
  const [type, setType] = useState<"market" | "limit" | "stop" | "ladder">("market");
  const [price, setPrice] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [trail, setTrail] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [count, setCount] = useState("4");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const has = Number.isFinite(bid) && Number.isFinite(ask);

  const size = defaults.sizeBy === "lots" ? defaults.lots : defaults.riskPct;
  const riskMoney = (broker.equity() * defaults.riskPct) / 100;

  /** Lots for one side, from the entry it would get and the stop. */
  const lotsFor = (side: Side): number | string => {
    if (defaults.sizeBy === "lots") return defaults.lots;
    const stop = num(sl);
    if (stop === null) return "Set a stop-loss to size by risk.";
    const entry = type === "market" ? (side === "buy" ? ask : bid) : num(price);
    if (entry === null) return "Set the order price first.";
    const lots = broker.lotsForRisk(riskMoney, entry, stop);
    return lots >= broker.settings.minLot ? lots : "That risk is less than the smallest size at this stop distance.";
  };

  const place = (side: Side) => {
    setError(null); setDone(null);
    const stop = num(sl), target = num(tp), tr = num(trail);
    let action: SimAction;
    if (type === "ladder") {
      const f = num(from), t = num(to), n = Math.round(num(count) ?? 0);
      if (f === null || t === null) return setError("Set where the ladder starts and ends.");
      if (stop === null) return setError("A ladder needs a stop-loss.");
      action = {
        kind: "ladder", side, from: f, to: t, count: n, sl: stop, tp: target,
        size: defaults.sizeBy === "lots" ? { lots: defaults.lots } : { risk: riskMoney },
      };
    } else {
      const lots = lotsFor(side);
      if (typeof lots === "string") return setError(lots);
      if (type === "market") action = { kind: "market", side, lots, sl: stop, tp: target, trail: tr };
      else {
        const p = num(price);
        if (p === null) return setError("Set the order price.");
        action = { kind: "pending", side, type, price: p, lots, sl: stop, tp: target, trail: tr };
      }
    }
    const err = onPlace(action);
    if (err) setError(err);
    else setDone(type === "market" ? `${side === "buy" ? "Bought" : "Sold"}.` : type === "ladder" ? "Ladder placed." : "Order placed.");
  };

  /** Target at a multiple of the stop distance from the entry. */
  const rTarget = (k: number) => {
    const stop = num(sl);
    const entry = type === "market" ? (stop !== null && stop < bid ? ask : bid) : num(price);
    if (stop === null || entry === null) return setError("Set the stop-loss first.");
    setTp(fmt(entry + k * (entry - stop)));
  };

  const preview = (side: Side) => {
    const l = type === "ladder" ? null : lotsFor(side);
    return typeof l === "number" ? `${l.toFixed(2)} lots` : null;
  };

  return (
    <div className="space-y-3">
      <Seg label="Order type" value={type} onChange={(v) => { setType(v); setError(null); }}
           options={[["market", "Market"], ["limit", "Limit"], ["stop", "Stop"], ["ladder", "Ladder"]]} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Size by">
          <Seg label="Size by" value={defaults.sizeBy} onChange={(v) => onDefaults({ ...defaults, sizeBy: v })} options={[["lots", "Lots"], ["risk", "Risk %"]]} />
        </Field>
        <Field label={defaults.sizeBy === "lots" ? (type === "ladder" ? "Total lots" : "Lots") : "Risk % of equity"}
               hint={defaults.sizeBy === "risk" ? `${money(riskMoney)}${type === "ladder" ? " across the ladder" : ""}` : undefined}>
          <input inputMode="decimal" className={inputCls} style={inputStyle} value={String(size)} aria-label="Size"
                 onChange={(e) => {
                   const v = num(e.target.value);
                   if (v === null) return;
                   onDefaults(defaults.sizeBy === "lots" ? { ...defaults, lots: v } : { ...defaults, riskPct: v });
                 }} />
        </Field>
      </div>

      {(type === "limit" || type === "stop") && (
        <Field label="Order price" hint={`Bid ${fmt(bid)} · ask ${fmt(ask)}`}>
          <input inputMode="decimal" className={inputCls} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={has ? fmt((bid + ask) / 2) : ""} />
        </Field>
      )}
      {type === "ladder" && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="From"><input inputMode="decimal" className={inputCls} style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input inputMode="decimal" className={inputCls} style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Orders"><input inputMode="numeric" className={inputCls} style={inputStyle} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Stop-loss"><input inputMode="decimal" className={inputCls} style={inputStyle} value={sl} onChange={(e) => setSl(e.target.value)} placeholder="price" /></Field>
        <Field label="Take-profit"><input inputMode="decimal" className={inputCls} style={inputStyle} value={tp} onChange={(e) => setTp(e.target.value)} placeholder="price" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span style={{ color: "var(--ink3)" }}>Target at</span>
        {[1, 2, 3].map((k) => (
          <button key={k} type="button" onClick={() => rTarget(k)} className="rounded-md px-2 py-1 font-semibold" style={{ background: "var(--s3)" }}>{k}R</button>
        ))}
        {type !== "ladder" && (
          <label className="ml-auto flex items-center gap-1.5">
            <span style={{ color: "var(--ink3)" }}>Trail</span>
            <input inputMode="decimal" className="num h-7 w-16 rounded-md px-1.5 text-[12.5px]" style={inputStyle} value={trail} onChange={(e) => setTrail(e.target.value)} placeholder="off" aria-label="Trailing stop distance" />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["sell", "buy"] as Side[]).map((side) => (
          <button key={side} type="button" disabled={!has} onClick={() => place(side)}
                  className="rounded-xl px-3 py-2.5 text-left text-white disabled:opacity-40"
                  style={{ background: side === "buy" ? "#2962ff" : "#f23645" }}>
            <span className="block text-[12px] font-semibold uppercase tracking-wide opacity-90">
              {side === "buy" ? "Buy" : "Sell"}{type === "market" ? "" : type === "ladder" ? " ladder" : ` ${type}`}
            </span>
            <span className="num block text-[17px] font-bold">{has ? fmt(side === "buy" ? ask : bid) : "—"}</span>
            {preview(side) && <span className="num block text-[11px] opacity-85">{preview(side)}</span>}
          </button>
        ))}
      </div>
      {error && <p className="text-[12.5px]" style={{ color: "var(--loss)" }} role="alert">{error}</p>}
      {done && !error && <p className="text-[12.5px]" style={{ color: "var(--profit)" }}>{done}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- positions */

export function Positions({ broker, onAct }: { broker: Broker; onAct: (a: SimAction) => string | null }) {
  const s = broker.state;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const run = (a: SimAction) => setError(onAct(a));

  if (!s.positions.length && !s.orders.length) {
    return <p className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>No open trades or orders.</p>;
  }
  return (
    <div className="space-y-2">
      {s.positions.map((p) => (
        <PositionRow key={p.id} p={p} pnl={broker.floating(p) + p.commission + p.swap} editing={editing === p.id}
                     onEdit={() => setEditing(editing === p.id ? null : p.id)} run={run} />
      ))}
      {s.orders.map((o) => <OrderRow key={o.id} o={o} run={run} />)}
      <div className="flex gap-2 pt-1">
        {s.positions.length > 0 && <button type="button" className="btn btn-secondary flex-1 !py-1.5 !text-[12.5px]" onClick={() => run({ kind: "closeAll" })}>Close all</button>}
        {s.orders.length > 0 && <button type="button" className="btn btn-secondary flex-1 !py-1.5 !text-[12.5px]" onClick={() => run({ kind: "cancelAll" })}>Cancel all orders</button>}
      </div>
      {error && <p className="text-[12.5px]" style={{ color: "var(--loss)" }} role="alert">{error}</p>}
    </div>
  );
}

function PositionRow({ p, pnl, editing, onEdit, run }: { p: OpenPosition; pnl: number; editing: boolean; onEdit: () => void; run: (a: SimAction) => void }) {
  const [sl, setSl] = useState(p.sl?.toFixed(2) ?? "");
  const [tp, setTp] = useState(p.tp?.toFixed(2) ?? "");
  const [trail, setTrail] = useState(p.trail ? String(p.trail) : "");
  const tone = pnl >= 0 ? "var(--profit)" : "var(--loss)";
  return (
    <div className="rounded-lg p-2.5" style={{ background: "var(--s2)", border: "1px solid var(--line)" }}>
      <div className="flex items-baseline gap-2 text-[13px]">
        <b style={{ color: p.side === "buy" ? "#2962ff" : "#f23645" }}>{p.side === "buy" ? "BUY" : "SELL"}</b>
        <span className="num">{p.lots.toFixed(2)} @ {p.openPrice.toFixed(2)}</span>
        <span className="num ml-auto font-semibold" style={{ color: tone }}>{money(pnl)}</span>
      </div>
      <div className="num mt-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>
        SL {p.sl?.toFixed(2) ?? "—"} · TP {p.tp?.toFixed(2) ?? "—"}{p.trail ? ` · trailing ${p.trail}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Small onClick={() => run({ kind: "close", id: p.id })}>Close</Small>
        <Small onClick={() => run({ kind: "close", id: p.id, lots: Math.max(0.01, Math.floor((p.lots / 2) * 100) / 100) })}>Close half</Small>
        <Small onClick={() => run({ kind: "breakeven", id: p.id })}>Breakeven</Small>
        <Small onClick={onEdit}>{editing ? "Done" : "Edit"}</Small>
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <input aria-label="Stop-loss" inputMode="decimal" className="num h-8 rounded-md px-2 text-[12.5px]" style={inputStyle} value={sl} onChange={(e) => setSl(e.target.value)} placeholder="SL" />
          <input aria-label="Take-profit" inputMode="decimal" className="num h-8 rounded-md px-2 text-[12.5px]" style={inputStyle} value={tp} onChange={(e) => setTp(e.target.value)} placeholder="TP" />
          <input aria-label="Trailing distance" inputMode="decimal" className="num h-8 rounded-md px-2 text-[12.5px]" style={inputStyle} value={trail} onChange={(e) => setTrail(e.target.value)} placeholder="Trail" />
          <button type="button" className="btn btn-primary col-span-3 !py-1.5 !text-[12.5px]" onClick={() => {
            run({ kind: "modify", id: p.id, sl: num(sl), tp: num(tp) });
            const t = num(trail);
            if ((t ?? null) !== (p.trail ?? null)) run({ kind: "trail", id: p.id, distance: t });
          }}>Save</button>
        </div>
      )}
    </div>
  );
}

function OrderRow({ o, run }: { o: PendingOrder; run: (a: SimAction) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg p-2.5 text-[12.5px]" style={{ background: "var(--s2)", border: "1px dashed var(--line)" }}>
      <span className="min-w-0 flex-1">
        <b>{o.side === "buy" ? "Buy" : "Sell"} {o.type}</b>{" "}
        <span className="num">{o.lots.toFixed(2)} @ {o.price.toFixed(2)}</span>
        <span className="num block text-[11.5px]" style={{ color: "var(--ink3)" }}>SL {o.sl?.toFixed(2) ?? "—"} · TP {o.tp?.toFixed(2) ?? "—"}</span>
      </span>
      <Small onClick={() => run({ kind: "cancel", id: o.id })}>Cancel</Small>
    </div>
  );
}

function Small({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="rounded-md px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: "var(--s3)", color: "var(--ink)" }}>{children}</button>;
}

/* ----------------------------------------------------------------- history */

export function History({ trades, timeZone }: { trades: TradeProps[]; timeZone: string }) {
  const f = useMemo(() => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }), [timeZone]);
  if (!trades.length) return <p className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>No finished trades yet.</p>;
  return (
    <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
      {[...trades].reverse().map((t) => (
        <li key={t.id} className="flex items-center gap-2 py-2 text-[12.5px]" style={{ borderColor: "var(--line)" }}>
          <span className="w-12 shrink-0 font-semibold" style={{ color: t.direction === "long" ? "#2962ff" : "#f23645" }}>{t.direction === "long" ? "Long" : "Short"}</span>
          <span className="num min-w-0 flex-1" style={{ color: "var(--ink2)" }}>
            <span className="block truncate">{f.format(new Date(t.openedAt))} · {t.lots.toFixed(2)} · {t.avgEntry.toFixed(2)} → {t.avgExit.toFixed(2)}</span>
            <span className="block truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{t.closeReasons.map((r) => REASON[r] ?? r).join(", ")}</span>
          </span>
          <span className="num shrink-0 text-right">
            <span className="block font-semibold" style={{ color: t.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>{money(t.pnl)}</span>
            {t.r !== null && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{t.r >= 0 ? "+" : ""}{t.r.toFixed(2)}R</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const REASON: Record<string, string> = { tp: "target", sl: "stop", user: "by hand", so: "stop-out", unknown: "?" };

/* ------------------------------------------------------------------- stats */

export function StatsView({ trades, compact = false }: { trades: TradeProps[]; compact?: boolean }) {
  const s = useMemo(() => backtestStats(trades.map(toRow)), [trades]);
  if (!s.n) return <p className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Stats appear after the first finished trade.</p>;
  const tiles: [string, string, ("pos" | "neg")?][] = [
    ["Net", money(s.net), s.net >= 0 ? "pos" : "neg"],
    ["Trades", String(s.n)],
    ["Win rate", pct(s.winRate)],
    ["Average R", s.avgR === null ? "—" : `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R`, s.avgR !== null ? (s.avgR >= 0 ? "pos" : "neg") : undefined],
    ["Total R", s.rCount ? `${s.sumR >= 0 ? "+" : ""}${s.sumR.toFixed(2)}R` : "—"],
    ["Expectancy", money(s.expectancy), s.expectancy >= 0 ? "pos" : "neg"],
    ["Profit factor", s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)],
    ["Max drawdown", money(-s.maxDrawdown)],
    ["Losing streak", String(s.longestLosingStreak)],
  ];
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-5"}`}>
        {tiles.map(([label, value, tone]) => (
          <div key={label} className="rounded-lg px-2.5 py-2" style={{ background: "var(--s2)", border: "1px solid var(--line)" }}>
            <div className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{label}</div>
            <div className="num text-[14.5px] font-semibold" style={{ color: tone === "pos" ? "var(--profit)" : tone === "neg" ? "var(--loss)" : "var(--ink)" }}>{value}</div>
          </div>
        ))}
      </div>
      <EquityCurve points={s.equity} />
      {s.n > 0 && s.rCount < s.n && (
        <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
          R is measured on the {s.rCount} of {s.n} trades that had a stop-loss when they were opened.
        </p>
      )}
    </div>
  );
}

function EquityCurve({ points }: { points: { t: number; pnl: number }[] }) {
  if (points.length < 2) return null;
  const w = 300, h = 70;
  const vals = [0, ...points.map((p) => p.pnl)];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - lo) / span) * (h - 6) - 3}`).join(" ");
  const zero = h - ((0 - lo) / span) * (h - 6) - 3;
  const last = vals[vals.length - 1];
  return (
    <figure>
      <figcaption className="mb-1 text-[11.5px] font-medium" style={{ color: "var(--ink3)" }}>Equity, trade by trade</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[70px] w-full" preserveAspectRatio="none" role="img" aria-label={`Equity curve ending at ${money(last)}`}>
        <line x1="0" x2={w} y1={zero} y2={zero} stroke="var(--line)" strokeDasharray="3 3" />
        <polyline points={xy} fill="none" stroke={last >= 0 ? "var(--profit)" : "var(--loss)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

/* ----------------------------------------------------------------- account */

export function AccountBar({ broker }: { broker: Broker }) {
  const equity = broker.equity(), margin = broker.margin();
  const open = equity - broker.state.balance;
  const items: [string, string, string?][] = [
    ["Balance", money(broker.state.balance)],
    ["Equity", money(equity)],
    ["Margin", money(margin)],
    ["Free", money(equity - margin)],
    ["Level", margin > 0 ? `${Math.round((equity / margin) * 100).toLocaleString("en-US")}%` : "—"],
    ["Open P&L", money(open), open === 0 ? undefined : open > 0 ? "var(--profit)" : "var(--loss)"],
  ];
  return (
    <div className="no-scrollbar flex gap-4 overflow-x-auto px-3 py-1.5 text-[11.5px]" style={{ borderTop: "1px solid var(--line)" }}>
      {items.map(([k, v, c]) => (
        <span key={k} className="shrink-0"><span style={{ color: "var(--ink3)" }}>{k} </span><b className="num" style={{ color: c ?? "var(--ink)" }}>{v}</b></span>
      ))}
    </div>
  );
}
