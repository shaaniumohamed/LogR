"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Drawing } from "lightweight-charts-drawing";
import { saveDrawings } from "@/lib/actions";
import type { Candle } from "@/lib/core/parse-candles";
import { priceDecimals } from "@/lib/core/instrument";
import { kitInterval, labelPresets } from "@/lib/chart/kit";
import type { ChartHandle } from "@/lib/chart/handle";
import type { Fill } from "@/components/candle-chart";

// Charting touches the canvas at construction, so both are browser-only modules.
const CandleChart = dynamic(() => import("@/components/candle-chart").then((m) => m.CandleChart), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />,
});
const DrawingSystem = dynamic(() => import("@/components/chart/drawing-system").then((m) => m.DrawingSystem), {
  ssr: false,
  loading: () => <div className="h-9 animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />,
});

type Status = "idle" | "saving" | "saved" | "failed";

/**
 * The trade's chart with the full drawing kit on it.
 *
 * `initialDrawings` arrive already in the kit's shape: the page converts mark-up
 * saved by the old five tools on the server, and the first change here writes
 * it back in the new shape.
 */
export function ChartPanel({
  identityHash, bars, htf, fills, timeZone, symbol, zoneFromFills, invalidation,
  initialDrawings, tradeFrom, tradeTo,
}: {
  identityHash: string;
  bars: Candle[];
  htf: Record<string, Candle[]>;
  fills: Fill[];
  timeZone: string;
  symbol: string;
  zoneFromFills: { low: number; high: number };
  invalidation: number | null;
  initialDrawings: Drawing[];
  tradeFrom: number;
  tradeTo: number;
}) {
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  const [tf, setTf] = useState("m1");
  const [expanded, setExpanded] = useState(false);

  /*
   * Saved as you go.
   *
   * A drawing that is only on screen is lost the moment the page is left —
   * which on a phone is one swipe. The drawing system hands over the whole set
   * a moment after the last change; it is written straight away. Saves never
   * overlap: a change that lands while one is in flight is picked up by the
   * same loop as soon as it returns. This runs outside React state on purpose,
   * so a save handed over as the page unmounts still goes.
   */
  const [status, setStatus] = useState<Status>("idle");
  const latest = useRef<Drawing[]>(initialDrawings);
  const rev = useRef(0);
  const saved = useRef(0);
  const inFlight = useRef(false);

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      while (saved.current < rev.current) {
        const at = rev.current;
        const r = await saveDrawings(identityHash, { v: 2, drawings: latest.current });
        if (!r.ok) throw new Error(r.error);
        saved.current = at;
      }
      setStatus("saved");
    } catch {
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  }, [identityHash]);

  const onSave = useCallback((d: Drawing[]) => {
    latest.current = d;
    rev.current += 1;
    setStatus("saving");
    void flush();
  }, [flush]);
  const onDirty = useCallback(() => setStatus((s) => (s === "failed" ? s : "saving")), []);

  // Leaving with a change still unsaved asks first, rather than dropping it.
  const unsaved = status === "saving" || status === "failed";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Escape leaves full screen — once the kit has had it: a first Escape drops
  // the tool in hand or the selection, and only an Escape nothing else used
  // closes the view. The check waits for every listener to have run.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) return;
      window.setTimeout(() => { if (!e.defaultPrevented) setExpanded(false); }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Full screen holds the page still underneath it.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

  const statusLine = status === "failed" ? (
    <span className="text-[12.5px]" style={{ color: "var(--loss)" }}>
      Couldn’t save.{" "}
      <button type="button" onClick={() => { setStatus("saving"); void flush(); }} className="tap font-semibold underline">
        Try again
      </button>
    </span>
  ) : status === "saving" ? (
    <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Saving…</span>
  ) : status === "saved" ? (
    <span className="text-[12.5px]" style={{ color: "var(--profit)" }}>Saved</span>
  ) : null;

  const expand = (
    <button type="button" onClick={() => setExpanded(true)} aria-label="Full screen" title="Full screen"
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold"
            style={{ background: "var(--s3)", color: "var(--ink)" }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
      </svg>
      {/* Icon only on a phone, where the strip has no room for the word. */}
      <span className="hidden sm:inline">Expand</span>
    </button>
  );

  return (
    /*
     * The same tree in both views, so the chart is never torn down: switching to
     * full screen keeps the zoom, the scroll and the drawing in progress.
     */
    <div className={expanded ? "fixed inset-0 z-[60] flex flex-col gap-2 px-3 pt-3" : "space-y-3"}
         style={expanded ? { background: "var(--plane)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : undefined}>
      {expanded && (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[15px] font-semibold">Mark up the chart</div>
          {statusLine}
          <button type="button" onClick={() => setExpanded(false)} className="btn btn-primary !px-4 !py-1.5 !text-[13px]">
            Done
          </button>
        </div>
      )}

      <div className={expanded ? "min-h-0 flex-1" : undefined}>
        <CandleChart
          bars={bars} htf={htf} fills={fills} timeZone={timeZone} symbol={symbol}
          onReady={setHandle} onTimeframe={setTf}
          zoneFromFills={zoneFromFills} invalidation={invalidation}
          tradeFrom={tradeFrom} tradeTo={tradeTo} fill={expanded}
        />
      </div>

      <div className={expanded ? "shrink-0" : "space-y-2"}>
        {handle && (
          <DrawingSystem
            handle={handle}
            // Only read when the chart is (re)made; by then the latest set is the truth.
            initial={latest.current}
            onSave={onSave} onDirty={onDirty} presets={labelPresets}
            interval={kitInterval(tf)} timeZone={timeZone} decimals={priceDecimals(symbol)}
            // In a scrolling page a finger over an idle chart may scroll the page;
            // full screen has nothing to scroll, so the chart takes every touch.
            pageScroll={!expanded}
            panelAbove
            extra={expanded ? undefined : expand}
          />
        )}
        {!expanded && statusLine && <div>{statusLine}</div>}
      </div>
    </div>
  );
}
