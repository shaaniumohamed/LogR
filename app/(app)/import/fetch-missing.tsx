"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MissingDay } from "@/lib/candles";

/**
 * The free plan allows eight calls a minute. Pacing to that in the client, rather
 * than firing everything and handling the refusals, keeps the backfill inside the
 * allowance and makes the wait honest instead of a stream of errors.
 */
const MS_BETWEEN_CALLS = 8_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Line = { day: string; text: string; bad?: boolean };

export function FetchMissing({ days, symbol, hasKey }: {
  days: MissingDay[];
  symbol: string;
  hasKey: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<Line[]>([]);
  const stop = useRef(false);
  const router = useRouter();

  if (!days.length) {
    return (
      <div className="card p-5">
        <div className="eyebrow">Coverage</div>
        <p className="mt-2 text-[15px]">Every trade you have imported has candles behind it.</p>
      </div>
    );
  }

  const tradesAffected = days.reduce((n, d) => n + d.trades, 0);

  async function run(list: MissingDay[]) {
    stop.current = false;
    setRunning(true); setDone(0); setTotal(list.length); setLog([]);

    for (let i = 0; i < list.length; i++) {
      if (stop.current) break;
      const started = Date.now();
      const d = list[i];
      try {
        const r = await fetch("/api/candles/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            from: `${d.day}T00:00:00.000Z`,
            to: `${d.day}T23:59:00.000Z`,
          }),
        });
        const j = await r.json();
        if (r.ok) {
          setLog((l) => [{ day: d.day, text: `${j.stored.toLocaleString("en-US")} candles` }, ...l]);
        } else {
          // Out of credits is the end of the run, not one bad day — carrying on
          // would just collect the same refusal a few hundred more times.
          const fatal = r.status === 429;
          setLog((l) => [{ day: d.day, text: j.detail ?? j.error ?? "failed", bad: true }, ...l]);
          if (fatal) { stop.current = true; }
        }
      } catch {
        setLog((l) => [{ day: d.day, text: "could not reach the server", bad: true }, ...l]);
      }
      setDone(i + 1);

      if (i < list.length - 1 && !stop.current) {
        await sleep(Math.max(0, MS_BETWEEN_CALLS - (Date.now() - started)));
      }
    }

    setRunning(false);
    router.refresh();
  }

  const minutes = (n: number) => Math.max(1, Math.round((n * MS_BETWEEN_CALLS) / 60_000));
  const recent = days.slice(0, 30);

  return (
    <div className="card p-5">
      <div className="eyebrow">Missing candles</div>
      <p className="mt-2 text-[15px]">
        {tradesAffected.toLocaleString("en-US")} of your trades, across {days.length} day
        {days.length === 1 ? "" : "s"}, have no price history behind them yet.
      </p>

      {!hasKey ? (
        <div className="mt-3 rounded-lg p-3 text-[13px] leading-relaxed"
             style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
          Automatic fetching is not switched on. Get a free key at <b>twelvedata.com</b>, then add{" "}
          <code className="num">TWELVEDATA_API_KEY</code> in Vercel → Settings → Environment
          Variables and redeploy. Until then you can still import a CSV below.
        </div>
      ) : running ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[13px]">
            <span>Day {done} of {total}</span>
            <button type="button" onClick={() => { stop.current = true; }}
                    style={{ color: "var(--ink3)" }}>Stop</button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <div className="h-full rounded-full"
                 style={{ width: `${total ? (done / total) * 100 : 0}%`, background: "var(--ink)" }} />
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink3)" }}>
            Paced to eight calls a minute, which is what the free plan allows. You can leave
            this tab and come back.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => run(recent)}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
            style={{ background: "var(--ink)", color: "var(--plane)" }}>
            Get the {recent.length} most recent {recent.length === 1 ? "day" : "days"}
            {" "}· about {minutes(recent.length)} min
          </button>
          {days.length > recent.length && (
            <button type="button" onClick={() => run(days)}
              className="rounded-lg px-3.5 py-2 text-[13px]"
              style={{ border: "1px solid var(--line)" }}>
              All {days.length} days · about {minutes(days.length)} min
            </button>
          )}
        </div>
      )}

      {log.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-[12px]">
          {log.map((l, i) => (
            <li key={`${l.day}-${i}`} className="flex gap-2">
              <span className="num" style={{ color: "var(--ink3)" }}>{l.day}</span>
              <span style={{ color: l.bad ? "var(--loss)" : "var(--ink2)" }}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
