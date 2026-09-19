"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  aggregate, checkAlignment, parseCandleCsv,
  type AlignmentReport, type Candle,
} from "@/lib/core/parse-candles";

/**
 * Where a price file's timestamps were written.
 *
 * Offered as zones rather than offsets because the two sources that need
 * shifting both observe daylight saving, so a single number is wrong for part of
 * every year. Picking the zone makes the file correct in March as well as June.
 */
const SOURCE_ZONES = [
  { value: "", label: "UTC — most price feeds" },
  { value: "America/New_York", label: "US Eastern — HistData files" },
  { value: "Europe/Athens", label: "MT4 / MT5 server time (UTC+2, +3 in summer)" },
] as const;

const UPLOAD_CHUNK = 10_000;

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "checked"; candles: Candle[]; format: string; skipped: number; report: AlignmentReport }
  | { kind: "saving"; done: number; total: number }
  | { kind: "saved"; written: number }
  | { kind: "error"; message: string };

const hrs = (minutes: number) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h > 0 ? "+" : ""}${h} hour${Math.abs(h) === 1 ? "" : "s"}`
                             : `${minutes > 0 ? "+" : ""}${minutes} minutes`;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

export function CandleImport({ defaultSymbol }: { defaultSymbol: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [zone, setZone] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const router = useRouter();

  async function readAndCheck(f: File, sourceZone: string) {
    setStage({ kind: "reading" });
    try {
      const { candles, format, skipped } = parseCandleCsv(await f.text(), {
        sourceZone: sourceZone || undefined,
      });

      // Ask the server only for the fills this file could possibly cover. A day
      // either side because the check sweeps shifts of up to fourteen hours.
      const pad = 86_400_000;
      const from = new Date(candles[0].time * 1000 - pad).toISOString();
      const to = new Date(candles[candles.length - 1].time * 1000 + pad).toISOString();
      const r = await fetch(`/api/fills?from=${from}&to=${to}`);
      const fills: [number, number][] = r.ok ? (await r.json()).fills : [];

      const report = checkAlignment(candles, fills.map(([time, price]) => ({ time, price })));
      setStage({ kind: "checked", candles, format, skipped, report });
    } catch (e) {
      setStage({ kind: "error", message: e instanceof Error ? e.message : "Could not read that file" });
    }
  }

  /** Apply the shift the check recommended, then re-run the check on the result. */
  function applyShift(candles: Candle[], minutes: number, format: string, skipped: number) {
    const shifted = candles.map((c) => ({ ...c, time: c.time + minutes * 60 }));
    (async () => {
      const pad = 86_400_000;
      const from = new Date(shifted[0].time * 1000 - pad).toISOString();
      const to = new Date(shifted[shifted.length - 1].time * 1000 + pad).toISOString();
      const r = await fetch(`/api/fills?from=${from}&to=${to}`);
      const fills: [number, number][] = r.ok ? (await r.json()).fills : [];
      setStage({
        kind: "checked", candles: shifted, skipped,
        format: `${format}, shifted ${hrs(minutes)}`,
        report: checkAlignment(shifted, fills.map(([time, price]) => ({ time, price }))),
      });
    })();
  }

  async function save(candles: Candle[]) {
    setStage({ kind: "saving", done: 0, total: candles.length });
    try {
      let written = 0;
      for (let i = 0; i < candles.length; i += UPLOAD_CHUNK) {
        const slice = candles.slice(i, i + UPLOAD_CHUNK);
        const r = await fetch("/api/candles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            source: "csv",
            bars: slice.map((c) => [c.time, c.open, c.high, c.low, c.close]),
          }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Upload failed");
        written += (await r.json()).written;
        setStage({ kind: "saving", done: Math.min(i + UPLOAD_CHUNK, candles.length), total: candles.length });
      }
      setStage({ kind: "saved", written });
      router.refresh();
    } catch (e) {
      setStage({ kind: "error", message: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  /* The instrument and source zone stay on screen through the whole flow: when
     the check reports a daylight-saving span, changing the zone IS the fix, and
     a fix that needs a Cancel first is a fix most people will not make. */
  const controls = (
    <div className="card grid gap-4 p-5 sm:grid-cols-2">
      <label className="block">
        <span className="text-[12px] font-medium" style={{ color: "var(--ink2)" }}>Instrument</span>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          className="num mt-1.5 w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--s1)", border: "1px solid var(--line)" }} />
        <span className="mt-1 block text-[11px]" style={{ color: "var(--ink3)" }}>
          Broker suffixes are trimmed, so XAUUSDm and XAUUSD share one set of candles.
        </span>
      </label>
      <label className="block">
        <span className="text-[12px] font-medium" style={{ color: "var(--ink2)" }}>Times in the file are</span>
        <select value={zone} onChange={(e) => { setZone(e.target.value); if (file) readAndCheck(file, e.target.value); }}
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
          {SOURCE_ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
        <span className="mt-1 block text-[11px]" style={{ color: "var(--ink3)" }}>
          Not sure? Leave it — your own fills will say whether it is right.
        </span>
      </label>
    </div>
  );

  /* ------------------------------------------------------------------ views */

  if (stage.kind === "reading") return <div className="card p-6 text-sm">Reading the file and checking it against your trades…</div>;

  if (stage.kind === "saving") {
    const pctDone = Math.round((stage.done / stage.total) * 100);
    return (
      <div className="card space-y-3 p-6">
        <div className="text-sm">Saving candles — {pctDone}%</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <div className="h-full rounded-full" style={{ width: `${pctDone}%`, background: "var(--ink)" }} />
        </div>
      </div>
    );
  }

  if (stage.kind === "saved") {
    return (
      <div className="card space-y-3 p-6">
        <div className="text-sm">
          Saved <b>{stage.written.toLocaleString("en-US")}</b> one-minute candles.
          Your trades in that date range now have a real chart.
        </div>
        <div className="flex gap-3">
          <a href="/trades" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
             style={{ background: "var(--ink)", color: "var(--plane)" }}>Open a trade</a>
          <button onClick={() => { setFile(null); setStage({ kind: "idle" }); }}
                  className="rounded-lg px-4 py-2.5 text-sm" style={{ color: "var(--ink2)" }}>
            Add another month
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "checked") {
    const { candles, report, format, skipped } = stage;
    const days = aggregate(candles, 1440).length;
    return (
      <div className="space-y-4">
        {controls}

        <div className="card p-5">
          <div className="eyebrow">What is in the file</div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="One-minute candles" value={candles.length.toLocaleString("en-US")} />
            <Fact label="Trading days" value={String(days)} />
            <Fact label="Covers" value={`${day(new Date(candles[0].time * 1000))} → ${day(new Date(candles[candles.length - 1].time * 1000))}`} />
            <Fact label="Rows ignored" value={skipped.toLocaleString("en-US")} />
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--ink3)" }}>Read using {format}.</p>
        </div>

        <AlignmentCard report={report}
          onShift={() => applyShift(candles, report.bestShiftMinutes, format, skipped)} />

        {/* Warn, do not block. A trader who knows their file is fine — a new
            instrument, a gap in their own history — should not be stopped by a
            check that had nothing to compare against. */}
        <div className="flex flex-wrap gap-3">
          <button onClick={() => save(candles)}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={report.checked > 0 && (report.score ?? 0) < 0.9
              ? { border: "1px solid var(--loss)", color: "var(--loss)" }
              : { background: "var(--ink)", color: "var(--plane)" }}>
            {report.checked > 0 && (report.score ?? 0) < 0.9 ? "Save anyway" : "Save"}
            {" "}{candles.length.toLocaleString("en-US")} candles as {symbol}
          </button>
          <button onClick={() => { setFile(null); setStage({ kind: "idle" }); }}
            className="rounded-lg px-4 py-2.5 text-sm" style={{ color: "var(--ink2)" }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stage.kind === "error" && (
        <div className="card p-4 text-sm" style={{ borderColor: "var(--loss)", color: "var(--loss)" }}>
          {stage.message}
        </div>
      )}

      {controls}

      <label className="card flex cursor-pointer flex-col items-center justify-center gap-2 p-12 text-center"
        style={{ borderStyle: "dashed" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); readAndCheck(f, zone); } }}>
        <span className="text-sm font-semibold">Drop a price CSV here</span>
        <span className="text-xs" style={{ color: "var(--ink3)" }}>or tap to choose a file</span>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); readAndCheck(f, zone); } }} />
      </label>
    </div>
  );
}

/**
 * The verdict on whether these candles are the same market at the same moments
 * as the trades already saved.
 *
 * Stated as a percentage of the trader's own fills rather than as a technical
 * status, because that is the sentence that makes the claim checkable: 98 out of
 * 100 of your entries land inside the candle they happened in.
 */
function AlignmentCard({ report, onShift }: { report: AlignmentReport; onShift: () => void }) {
  const { checked, score, bestShiftMinutes, bestScore } = report;

  if (checked === 0) {
    return (
      <div className="card p-5">
        <div className="eyebrow">Not checked</div>
        <p className="mt-2 text-[15px]">You have no trades in this file&rsquo;s date range, so there is nothing to check it against.</p>
        <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          That is fine — import it. The check runs again automatically next time the ranges overlap.
        </p>
      </div>
    );
  }

  const pctIn = Math.round((score ?? 0) * 100);
  const good = (score ?? 0) >= 0.9;
  const fixable = !good && bestShiftMinutes !== 0 && (bestScore ?? 0) >= 0.9;
  const dst = !good && !fixable && report.dstLikely;

  return (
    <div className="card p-5" style={{ borderColor: good ? undefined : "var(--loss)" }}>
      <div className="eyebrow">{good ? "These line up" : "These do not line up"}</div>
      <p className="mt-2 text-[15px]">
        {pctIn}% of your {checked.toLocaleString("en-US")} fills in this date range land inside the
        candle they happened in.
      </p>

      {good ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          That is what a correct file looks like. Save it.
        </p>
      ) : fixable ? (
        <>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
            Shifted by {hrs(bestShiftMinutes)} they would match {Math.round((bestScore ?? 0) * 100)}%.
            That is a time zone, not bad data.
          </p>
          <button onClick={onShift}
            className="mt-3 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
            style={{ background: "var(--ink)", color: "var(--plane)" }}>
            Shift the candles {hrs(bestShiftMinutes)}
          </button>
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
            If the file spans a daylight-saving change, pick the source zone above instead — a
            single shift would be an hour out for part of it.
          </p>
        </>
      ) : dst ? (
        <>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
            Part of this file needs one shift and the rest needs a shift an hour away, which
            together explain {Math.round((report.combinedScore ?? 0) * 100)}% of your fills. That
            is a daylight-saving change inside the file — the candles are right, the clock is not.
          </p>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
            Set <b>Times in the file are</b> above to the zone the file was written in. HistData
            uses US Eastern. A single shift cannot fix this, so there is no one-tap button for it.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          No shift fixes it, so this is probably a different instrument, or prices on a
          different scale. Importing it anyway would put wrong candles behind your trades.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-medium" style={{ color: "var(--ink2)" }}>
          How this is checked
        </summary>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
          A fill happened at a price the market was really trading, so it has to sit between the
          high and the low of the minute it happened in. Checking every fill against the file turns
          &ldquo;do these candles belong to these trades?&rdquo; into a number.
          <br /><br />
          A little slack is allowed because your fill includes the spread and most price files are
          bid-only. Nothing is saved until you have seen this figure.
        </p>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num text-lg font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink3)" }}>{label}</div>
    </div>
  );
}
