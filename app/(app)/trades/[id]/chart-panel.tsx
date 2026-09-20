"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { saveDrawings } from "@/lib/actions";
import { DRAWING_LABELS } from "@/lib/core/taxonomy";
import type { Candle } from "@/lib/core/parse-candles";
import type { Drawing } from "@/lib/core/types";
import type { Fill } from "@/components/candle-chart";

// Charting touches the canvas at construction, so it is a browser-only module.
const CandleChart = dynamic(() => import("@/components/candle-chart").then((m) => m.CandleChart), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />,
});

type Pending = { label: string; kind: "zone" | "level"; first: number | null } | null;

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
  const [drawings, setDrawings] = useState<Drawing[]>(initialDrawings);
  const [pending, setPending] = useState<Pending>(null);
  // Naming a band is how mark-up becomes something you can look back across: a
  // level called "Aug high" reads as an idea months later, where a sixth
  // "Demand zone" reads as nothing at all.
  const [naming, setNaming] = useState(false);
  const [customName, setCustomName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();

  function handlePick(price: number) {
    if (!pending) return;
    if (pending.kind === "level") {
      add({ id: crypto.randomUUID(), kind: "level", low: price, high: price, label: pending.label });
      setPending(null);
      return;
    }
    if (pending.first === null) { setPending({ ...pending, first: price }); return; }
    add({
      id: crypto.randomUUID(), kind: "zone",
      low: Math.min(pending.first, price), high: Math.max(pending.first, price),
      label: pending.label,
    });
    setPending(null);
  }

  function add(d: Drawing) { setDrawings((xs) => [...xs, d]); setDirty(true); setSaved(false); }
  function remove(id: string) { setDrawings((xs) => xs.filter((x) => x.id !== id)); setDirty(true); setSaved(false); }

  function save() {
    startSaving(async () => {
      await saveDrawings(identityHash, drawings);
      setDirty(false); setSaved(true);
    });
  }

  return (
    <div className="space-y-3">
      <CandleChart
        bars={bars} htf={htf} fills={fills} timeZone={timeZone} symbol={symbol}
        drawings={drawings} drawMode={pending ? pending.kind : null} onPick={handlePick}
        zoneFromFills={zoneFromFills} invalidation={invalidation}
        tradeFrom={tradeFrom} tradeTo={tradeTo}
      />

      {/* One tap arms a label, the next tap (or two, for a zone) places it. No
          modal, no separate "what is this?" step — on a phone every extra screen
          is a reason not to bother. */}
      <div className="rounded-xl p-3" style={{ background: "var(--s3)" }}>
        {pending ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <b>{pending.label}:</b>
            <span style={{ color: "var(--ink2)" }}>
              {pending.kind === "level"
                ? "tap the chart at the level"
                : pending.first === null ? "tap one edge of the zone" : "now tap the other edge"}
            </span>
            <button type="button" onClick={() => setPending(null)}
              className="ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>Cancel</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] font-medium" style={{ color: "var(--ink2)" }}>Mark up:</span>
              {DRAWING_LABELS.map((d) => (
                <button key={d.key} type="button"
                  onClick={() => setPending({ label: d.label, kind: d.kind, first: null })}
                  className="rounded-full px-2.5 py-1 text-[12px]"
                  style={{ border: "1px solid var(--line)", background: "var(--s1)" }}>
                  {d.label}
                </button>
              ))}
              <button type="button" onClick={() => setNaming((v) => !v)}
                className="rounded-full px-2.5 py-1 text-[12px]"
                style={{ border: "1px dashed var(--line)", background: "var(--s1)",
                         color: naming ? "var(--ink)" : "var(--ink2)" }}>
                Name your own
              </button>
            </div>

            {naming && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value.slice(0, 40))}
                  placeholder="e.g. August high"
                  className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[13px]"
                  style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }}
                />
                {(["level", "zone"] as const).map((kind) => (
                  <button key={kind} type="button" disabled={!customName.trim()}
                    onClick={() => {
                      setPending({ label: customName.trim(), kind, first: null });
                      setNaming(false); setCustomName("");
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold"
                    style={{ background: customName.trim() ? "var(--ink)" : "var(--s1)",
                             color: customName.trim() ? "var(--plane)" : "var(--ink3)",
                             border: "1px solid var(--line)" }}>
                    {kind === "level" ? "as a line" : "as a band"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {drawings.length > 0 && (
        <ul className="space-y-1 text-[13px]">
          {drawings.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="inline-block h-2 w-4 rounded-sm"
                    style={{ background: "color-mix(in srgb, var(--c2) 40%, transparent)", border: "1px dashed var(--c2)" }} />
              <span>{d.label}</span>
              <span className="num" style={{ color: "var(--ink2)" }}>
                {d.kind === "zone" ? `${d.low.toFixed(2)} – ${d.high.toFixed(2)}` : d.low.toFixed(2)}
              </span>
              <button type="button" onClick={() => remove(d.id)}
                className="ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {(dirty || saved) && (
        <div className="flex items-center gap-3">
          {dirty && (
            <button type="button" onClick={save} disabled={isSaving}
              className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
              style={{ background: "var(--ink)", color: "var(--plane)", opacity: isSaving ? 0.6 : 1 }}>
              {isSaving ? "Saving…" : "Save mark-up"}
            </button>
          )}
          {saved && !dirty && <span className="text-[13px]" style={{ color: "var(--profit)" }}>Mark-up saved</span>}
        </div>
      )}
    </div>
  );
}
