"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, createStrategy, deleteSession, deleteStrategy, updateStrategy } from "@/lib/backtest-actions";
import { wallToUtc } from "@/lib/core/zones";
import { START_WHEN, type StartWhen } from "@/lib/core/replay/clock";

const readWhen = (): StartWhen => {
  try { const v = localStorage.getItem("logr.bt.startWhen"); return v && START_WHEN.some((w) => w.key === JSON.parse(v)) ? JSON.parse(v) : "day"; } catch { return "day"; }
};
const writeWhen = (v: StartWhen) => { try { localStorage.setItem("logr.bt.startWhen", JSON.stringify(v)); } catch { /* fine */ } };

const inputCls = "h-10 w-full rounded-lg px-3 text-[14px]";
const inputStyle = { background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" } as const;

/** A strategy is the thing sessions are grouped under: a way of trading being tested. */
export function NewStrategy() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createStrategy, null);
  if (!open && !state?.error) {
    return <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>New strategy</button>;
  }
  return (
    <form action={action} className="card space-y-3">
      <div className="text-[15px] font-semibold">New strategy</div>
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-medium" style={{ color: "var(--ink3)" }}>Name</span>
        <input name="name" required maxLength={80} className={inputCls} style={inputStyle} placeholder="e.g. London sweep and reclaim" autoFocus />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-medium" style={{ color: "var(--ink3)" }}>What it is (optional)</span>
        <textarea name="description" rows={3} maxLength={2000} className="w-full rounded-lg px-3 py-2 text-[14px]" style={inputStyle}
                  placeholder="The setup, the entry, where the stop goes, what you are testing." />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-medium" style={{ color: "var(--ink3)" }}>Journal setup it matches (optional)</span>
        <input name="setup" maxLength={80} className={inputCls} style={inputStyle} placeholder="So backtest and live can be compared later" />
      </label>
      {state?.error && <p className="text-[13px]" style={{ color: "var(--loss)" }} role="alert">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * A new replay: where it starts, and the account it trades with.
 *
 *  - A random day: any held weekday in a range, so the chart can't be read
 *    with hindsight, starting where in the day the trader chooses.
 *  - A date I pick: a date and time on the trader's own clock.
 *  - Pick on the chart: opens at the latest data with a line to click where
 *    the replay should begin, as on TradingView.
 */
export function NewSession({ strategyId, timeZone, range }: { strategyId: string; timeZone: string; range: { first: string; last: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"date" | "random" | "pick">("random");
  const [from, setFrom] = useState(range.first);
  const [to, setTo] = useState(range.last);
  const [when, setWhen] = useState<StartWhen>("day");
  useEffect(() => { setWhen(readWhen()); }, []);
  const [date, setDate] = useState(range.last);
  const [time, setTime] = useState("07:00");
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("10000");
  const [leverage, setLeverage] = useState("500");
  const [commission, setCommission] = useState("0");
  const [spread, setSpread] = useState<"recorded" | "fixed" | "minus">("recorded");
  const [spreadValue, setSpreadValue] = useState("0.10");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return <button type="button" className="btn btn-secondary !text-[13px]" onClick={() => setOpen(true)}>New session</button>;

  const submit = async () => {
    setError(null);
    const n = (v: string) => Number(v.replace(",", "."));
    let start: { at: number } | { random: true; from?: string; to?: string; when?: StartWhen } | { pick: true };
    if (mode === "random") {
      if (from && to && from > to) return setError("The range ends before it starts.");
      start = { random: true, from: from || undefined, to: to || undefined, when };
    } else if (mode === "pick") start = { pick: true };
    else {
      const [y, m, d] = date.split("-").map(Number);
      const [hh, mm] = time.split(":").map(Number);
      if (!y || !m || !d) return setError("Pick a start date.");
      start = { at: Math.floor(wallToUtc(Date.UTC(y, m - 1, d, hh || 0, mm || 0), timeZone) / 1000) };
    }
    setBusy(true);
    const r = await createSession({
      strategyId, name: name || undefined, start,
      settings: {
        balance: n(balance), leverage: Math.round(n(leverage)), commissionPerLot: n(commission),
        spread: spread === "recorded" ? { mode: "recorded" } : { mode: spread, value: n(spreadValue) },
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/backtest/s/${r.id}${mode === "pick" ? "?pick=1" : ""}`);
  };

  return (
    <div className="space-y-3 rounded-xl p-3" style={{ background: "var(--s2)", border: "1px solid var(--line)" }}>
      <div className="text-[14px] font-semibold">New session</div>
      <div className="seg w-full" role="group" aria-label="Start">
        <button type="button" aria-pressed={mode === "random"} onClick={() => setMode("random")} className="flex-1 !py-1.5 !text-[12.5px]">A random day</button>
        <button type="button" aria-pressed={mode === "date"} onClick={() => setMode("date")} className="flex-1 !py-1.5 !text-[12.5px]">A date I pick</button>
        <button type="button" aria-pressed={mode === "pick"} onClick={() => setMode("pick")} className="flex-1 !py-1.5 !text-[12.5px]">Pick on the chart</button>
      </div>
      {mode === "random" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Between</span>
              <input type="date" value={from} min={range.first} max={range.last} onChange={(e) => setFrom(e.target.value)} className={inputCls} style={inputStyle} aria-label="Random from" /></label>
            <label><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>and</span>
              <input type="date" value={to} min={range.first} max={range.last} onChange={(e) => setTo(e.target.value)} className={inputCls} style={inputStyle} aria-label="Random to" /></label>
          </div>
          <label className="block"><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Start at</span>
            <select value={when} onChange={(e) => { const v = e.target.value as StartWhen; setWhen(v); writeWhen(v); }} className={inputCls} style={inputStyle} aria-label="Start at">
              {START_WHEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select></label>
        </div>
      )}
      {mode === "pick" && (
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          The chart opens at the latest data. Move the line to where the replay should begin and click — everything after it disappears.
        </p>
      )}
      {mode === "date" && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} min={range.first} max={range.last} onChange={(e) => setDate(e.target.value)} className={inputCls} style={inputStyle} aria-label="Start date" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} style={inputStyle} aria-label="Start time" />
        </div>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} style={inputStyle} placeholder="Name (optional)" aria-label="Session name" />
      <div className="grid grid-cols-3 gap-2">
        <label><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Balance $</span>
          <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className={inputCls} style={inputStyle} /></label>
        <label><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Leverage 1:</span>
          <input inputMode="numeric" value={leverage} onChange={(e) => setLeverage(e.target.value)} className={inputCls} style={inputStyle} /></label>
        <label><span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Commission $/lot</span>
          <input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} className={inputCls} style={inputStyle} /></label>
      </div>
      <div>
        <span className="mb-1 block text-[11.5px]" style={{ color: "var(--ink3)" }}>Spread</span>
        <div className="flex gap-2">
          <select value={spread} onChange={(e) => setSpread(e.target.value as typeof spread)} className={`${inputCls} flex-1`} style={inputStyle} aria-label="Spread">
            <option value="recorded">As recorded in the data</option>
            <option value="minus">Recorded, narrowed by</option>
            <option value="fixed">Fixed at</option>
          </select>
          {spread !== "recorded" && <input inputMode="decimal" value={spreadValue} onChange={(e) => setSpreadValue(e.target.value)} className={`${inputCls} w-24`} style={inputStyle} aria-label="Spread value" />}
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
          The Exness files carry Standard-account spreads. To match a Pro account, narrow them by roughly the difference you see live.
        </p>
      </div>
      {error && <p className="text-[13px]" style={{ color: "var(--loss)" }} role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Starting…" : "Start replay"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Two taps to remove, so a stray one never deletes a month of practice. */
export function RemoveButton({ what, id, kind }: { what: string; id: string; kind: "session" | "strategy" }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className="tap text-[12.5px] font-semibold" style={{ color: "var(--loss)" }}
            onClick={async () => {
              if (!armed) { setArmed(true); window.setTimeout(() => setArmed(false), 4000); return; }
              const r = kind === "session" ? await deleteSession(id) : await deleteStrategy(id);
              if (r.ok) router.push(kind === "strategy" ? "/backtest" : ".");
              router.refresh();
            }}>
      {armed ? `Delete ${what} — tap again` : `Delete ${what}`}
    </button>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  return (
    <button type="button" className="tap text-[12.5px] font-semibold" style={{ color: "var(--ink3)" }}
            onClick={async () => { await updateStrategy(id, { archived: !archived }); router.refresh(); }}>
      {archived ? "Bring back" : "Archive"}
    </button>
  );
}
