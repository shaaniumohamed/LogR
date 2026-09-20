"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HIGHER_TIMEFRAMES } from "@/lib/core/timeframes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The free plan allows eight calls a minute; four calls paced well inside it. */
const MS_BETWEEN_CALLS = 8_000;

type Line = { tf: string; text: string; bad?: boolean };

/**
 * Four calls, once, and every trade in the account gets its higher-timeframe
 * context permanently.
 *
 * Worth its own control rather than being folded into the day-by-day backfill
 * because the arithmetic is so different that they are not the same job. A
 * minute backfill is one call per trading day and a year of history is hundreds
 * of them. A single call at four hours returns two years and at a day returns
 * thirteen, so this finishes in half a minute and never needs running again
 * except to pick up recent bars.
 */
export function FetchHigherTimeframes({ symbol, hasKey, held }: {
  symbol: string;
  hasKey: boolean;
  /** Which intervals are already stored, and how many bars of each. */
  held: { tf: string; bars: number; from: string; to: string }[];
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<Line[]>([]);
  const router = useRouter();

  const byTf = new Map(held.map((h) => [h.tf, h]));
  const missing = HIGHER_TIMEFRAMES.filter((t) => !byTf.has(t.key));

  async function run() {
    setRunning(true); setLog([]);
    for (let i = 0; i < HIGHER_TIMEFRAMES.length; i++) {
      const tf = HIGHER_TIMEFRAMES[i];
      const started = Date.now();
      try {
        const r = await fetch("/api/candles/htf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, tf: tf.key }),
        });
        const j = await r.json();
        setLog((l) => [{
          tf: tf.label,
          text: r.ok ? `${j.stored.toLocaleString("en-US")} candles` : (j.detail ?? j.error ?? "failed"),
          bad: !r.ok,
        }, ...l]);
        // Out of credits ends the run; the next three would collect the same refusal.
        if (r.status === 429) break;
      } catch {
        setLog((l) => [{ tf: tf.label, text: "could not reach the server", bad: true }, ...l]);
      }
      if (i < HIGHER_TIMEFRAMES.length - 1) {
        await sleep(Math.max(0, MS_BETWEEN_CALLS - (Date.now() - started)));
      }
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="eyebrow">Daily and weekly context</div>
      <p className="mt-2 text-[15px]">
        {missing.length === 0
          ? `All four higher timeframes are held for ${symbol}.`
          : held.length === 0
            ? `Four calls fetch hourly, four-hourly, daily and weekly candles for ${symbol} — enough for every trade you have, and every trade you will take.`
            : `${missing.map((t) => t.label).join(", ")} ${missing.length === 1 ? "is" : "are"} still missing.`}
      </p>

      {held.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12.5px]">
          {HIGHER_TIMEFRAMES.map((t) => {
            const h = byTf.get(t.key);
            return (
              <li key={t.key} className="flex items-center gap-3">
                <span className="w-8 shrink-0 font-semibold">{t.label}</span>
                {h ? (
                  <span className="num truncate" style={{ color: "var(--ink2)" }}>
                    {h.bars.toLocaleString("en-US")} candles · {h.from} → {h.to}
                  </span>
                ) : (
                  <span style={{ color: "var(--ink3)" }}>not fetched</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!hasKey ? (
        <div className="mt-3 rounded-lg p-3 text-[13px] leading-relaxed"
             style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
          Automatic fetching is not switched on. Get a free key at <b>twelvedata.com</b>, then add{" "}
          <code className="num">TWELVEDATA_API_KEY</code> in Vercel → Settings → Environment
          Variables and redeploy.
        </div>
      ) : (
        <div className="mt-3">
          <button type="button" onClick={run} disabled={running}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
            style={{ background: "var(--ink)", color: "var(--plane)", opacity: running ? 0.6 : 1 }}>
            {running ? "Fetching…" : held.length === 0 ? "Get all four · about 30 seconds" : "Refresh all four · about 30 seconds"}
          </button>
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
            Four calls out of the eight hundred a day the free plan allows. Re-running replaces
            what is held and picks up bars since the last time.
          </p>
        </div>
      )}

      {log.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px]">
          {log.map((l, i) => (
            <li key={`${l.tf}-${i}`} className="flex gap-2">
              <span className="num w-8 shrink-0" style={{ color: "var(--ink3)" }}>{l.tf}</span>
              <span style={{ color: l.bad ? "var(--loss)" : "var(--ink2)" }}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
