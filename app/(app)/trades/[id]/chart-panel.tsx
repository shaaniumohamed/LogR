"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { saveDrawings } from "@/lib/actions";
import { DRAWING_PRESETS } from "@/lib/core/taxonomy";
import { DRAW_COLORS, LABEL_MAX, NOTE_MAX, colorToken, drawingPrices } from "@/lib/core/drawings";
import type { Candle } from "@/lib/core/parse-candles";
import type { DrawColor, Drawing } from "@/lib/core/types";
import type { Fill, NewDrawing, Tool } from "@/components/candle-chart";

// Charting touches the canvas at construction, so it is a browser-only module.
const CandleChart = dynamic(() => import("@/components/candle-chart").then((m) => m.CandleChart), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />,
});

/*
 * Five tools, named the way anyone would describe them.
 *
 * Each says what the next tap does, because a drawing tool that waits silently
 * for input is the commonest way to lose someone on a phone. Two-tap tools
 * change their instruction after the first tap.
 */
const TOOLS: { key: Tool; label: string; first: string; second?: string }[] = [
  { key: "level", label: "Line", first: "Tap the chart at the price." },
  { key: "zone", label: "Zone", first: "Tap one edge of the zone.", second: "Now tap the other edge." },
  { key: "box", label: "Box", first: "Tap one corner, on the candle it starts at.", second: "Now tap the opposite corner." },
  { key: "trend", label: "Trend", first: "Tap where the line starts.", second: "Now tap where it ends." },
  { key: "note", label: "Note", first: "Tap the candle the note is about." },
];

const KIND_NAME: Record<Drawing["kind"], string> = {
  level: "Line", zone: "Zone", box: "Box", trend: "Trend line", note: "Note",
};

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
  const [tool, setTool] = useState<Tool | null>(null);
  const [placed, setPlaced] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [undo, setUndo] = useState<{ d: Drawing; at: number } | null>(null);

  /*
   * Saved as you go.
   *
   * Mark-up used to wait for a "Save" button, and a drawing that is only on
   * screen is lost the moment the page is left — which on a phone is one
   * swipe. Every change bumps a revision; a moment after the last one, the
   * whole set is written. Saves never overlap: one that lands while another is
   * in flight waits for it, then writes whatever is newest.
   */
  const [rev, setRev] = useState(0);
  const [savedRev, setSavedRev] = useState(0);
  const [failed, setFailed] = useState(false);
  const latest = useRef(drawings);
  latest.current = drawings;
  const revRef = useRef(rev);
  revRef.current = rev;
  const inFlight = useRef(false);

  async function flush() {
    if (inFlight.current) return;
    inFlight.current = true;
    const at = revRef.current;
    try {
      const r = await saveDrawings(identityHash, latest.current);
      if (!r.ok) throw new Error(r.error);
      setSavedRev((s) => Math.max(s, at));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    if (rev === savedRev || failed) return;
    const h = setTimeout(flush, 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, savedRev, failed]);

  // Leaving with a change still unsaved asks first, rather than dropping it.
  const unsaved = rev !== savedRev;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function commit(next: (xs: Drawing[]) => Drawing[]) {
    setDrawings(next);
    setRev((r) => r + 1);
    setFailed(false);
  }

  function create(nd: NewDrawing) {
    const id = crypto.randomUUID().slice(0, 13);
    const d = { ...nd, id, label: "", color: nd.kind === "note" ? "blue" : "amber" } as Drawing;
    commit((xs) => [...xs, d]);
    setTool(null);
    setUndo(null);
    setSelected(id);
  }

  function update(id: string, patch: Partial<Drawing>) {
    commit((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Drawing) : x)));
  }

  function remove(id: string) {
    const at = drawings.findIndex((x) => x.id === id);
    if (at < 0) return;
    const d = drawings[at];
    commit((xs) => xs.filter((x) => x.id !== id));
    setSelected(null);
    // A note that never had words is not worth an undo.
    if (!(d.kind === "note" && !d.label)) setUndo({ d, at });
  }

  function restore() {
    if (!undo) return;
    const { d, at } = undo;
    commit((xs) => [...xs.slice(0, at), d, ...xs.slice(at)]);
    setUndo(null);
    setSelected(d.id);
  }

  // Putting down a note that was never written drops it, instead of leaving an
  // empty bubble on the chart.
  function select(id: string | null) {
    if (selected && selected !== id) {
      const prev = drawings.find((x) => x.id === selected);
      if (prev?.kind === "note" && !prev.label.trim()) {
        commit((xs) => xs.filter((x) => x.id !== prev.id));
      }
    }
    setSelected(id);
    if (id) setUndo(null);
  }

  const current = drawings.find((x) => x.id === selected) ?? null;

  // Keys for a desktop: Escape steps back, Delete removes what is selected.
  const keys = useRef({ tool, current, expanded });
  keys.current = { tool, current, expanded };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = keys.current;
      if (e.key === "Escape") {
        if (k.tool) setTool(null);
        else if (k.current) setSelected(null);
        else if (k.expanded) setExpanded(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && k.current) {
        e.preventDefault();
        removeRef.current(k.current.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const removeRef = useRef(remove);
  removeRef.current = remove;

  // Full screen holds the page still underneath it.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);

  const armed = TOOLS.find((t) => t.key === tool) ?? null;

  const status = failed ? (
    <span className="text-[12.5px]" style={{ color: "var(--loss)" }}>
      Couldn’t save.{" "}
      <button type="button" onClick={() => { setFailed(false); flush(); }} className="tap font-semibold underline">
        Try again
      </button>
    </span>
  ) : undo ? (
    <span className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
      Deleted.{" "}
      <button type="button" onClick={restore} className="tap font-semibold" style={{ color: "var(--c1)" }}>Undo</button>
    </span>
  ) : unsaved ? (
    <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Saving…</span>
  ) : savedRev > 0 ? (
    <span className="text-[12.5px]" style={{ color: "var(--profit)" }}>Saved</span>
  ) : null;

  return (
    /*
     * The same tree in both views, so the chart is never torn down: switching to
     * full screen keeps the zoom and scroll the trader was looking at.
     */
    <div className={expanded ? "fixed inset-0 z-[60] flex flex-col gap-2 px-3 pt-3" : "space-y-3"}
         style={expanded ? { background: "var(--plane)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : undefined}>
      {expanded && (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[15px] font-semibold">Mark up the chart</div>
          {status}
          <button type="button" onClick={() => { setTool(null); setExpanded(false); }} className="btn btn-primary !px-4 !py-1.5 !text-[13px]">
            Done
          </button>
        </div>
      )}

      <div className={expanded ? "min-h-0 flex-1" : undefined}>
        <CandleChart
          bars={bars} htf={htf} fills={fills} timeZone={timeZone} symbol={symbol}
          drawings={drawings} tool={tool} onCreate={create} onDraft={setPlaced}
          selected={selected} onSelect={select} onMove={(d) => update(d.id, d)}
          zoneFromFills={zoneFromFills} invalidation={invalidation}
          tradeFrom={tradeFrom} tradeTo={tradeTo} fill={expanded}
        />
      </div>

      <div className={expanded ? "max-h-[45vh] shrink-0 space-y-2 overflow-y-auto" : "space-y-2"}>
        {/* The tools, or what the armed one wants next. One row of equal
            buttons with the word under the icon, so all of them fit across a
            phone without any falling onto a second line. */}
        <div className={`grid gap-1 ${expanded ? "grid-cols-5" : "grid-cols-6"}`} role="group" aria-label="Drawing tools">
          {TOOLS.map((t) => {
            const on = tool === t.key;
            return (
              <button key={t.key} type="button" aria-pressed={on}
                      onClick={() => { select(null); setTool(on ? null : t.key); }}
                      className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors"
                      style={on
                        ? { background: "var(--ink)", color: "var(--plane)" }
                        : { background: "var(--s3)", color: "var(--ink)" }}>
                <ToolIcon tool={t.key} />
                {t.label}
              </button>
            );
          })}
          {!expanded && (
            <button type="button" onClick={() => setExpanded(true)}
                    className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium"
                    style={{ background: "var(--s3)", color: "var(--ink)" }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
              </svg>
              Expand
            </button>
          )}
        </div>

        {armed && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
               style={{ background: "color-mix(in srgb, var(--c1) 10%, transparent)", color: "var(--ink)" }}>
            <span className="min-w-0 flex-1">{placed && armed.second ? armed.second : armed.first}</span>
            <button type="button" onClick={() => setTool(null)} className="tap text-[12.5px] font-medium" style={{ color: "var(--ink3)" }}>
              Cancel
            </button>
          </div>
        )}

        {current && !tool && (
          <Editor key={current.id} d={current}
                  onChange={(patch) => update(current.id, patch)}
                  onDelete={() => remove(current.id)}
                  onDone={() => select(null)} />
        )}

        {!expanded && status && <div>{status}</div>}
      </div>

      {!expanded && drawings.length > 0 && (
        <ul className="text-[13px]" aria-label="Your mark-up">
          {drawings.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => select(d.id === selected ? null : d.id)}
                      className="flex w-full items-center gap-2.5 py-2 text-left"
                      style={{ borderTop: "1px solid var(--line)" }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${colorToken(d.color)})` }} />
                <span className="min-w-0 flex-1 truncate" style={{ fontWeight: d.id === selected ? 600 : 400 }}>
                  {d.label || <span style={{ color: "var(--ink3)" }}>Unnamed {KIND_NAME[d.kind].toLowerCase()}</span>}
                </span>
                <span className="num shrink-0 text-[12px]" style={{ color: "var(--ink3)" }}>
                  {KIND_NAME[d.kind]} · {drawingPrices(d)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Name, colour and delete, for the drawing that is selected.
 *
 * The names on offer depend on what was drawn — a note gets the moments that
 * are a reason to take a trade, a box gets order blocks and gaps — so the
 * common case is one tap. A note opens with the keyboard up, because a note's
 * whole content is the words.
 */
function Editor({ d, onChange, onDelete, onDone }: {
  d: Drawing;
  onChange: (patch: Partial<Drawing>) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const presets = DRAWING_PRESETS[d.kind];
  const isNote = d.kind === "note";
  return (
    <div role="group" aria-label="Edit drawing" className="space-y-2.5 rounded-xl p-3"
         style={{ background: "var(--s2)", border: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${colorToken(d.color)})` }} />
        <span className="min-w-0 flex-1 text-[13px] font-semibold">
          {KIND_NAME[d.kind]} <span className="num font-normal" style={{ color: "var(--ink3)" }}>{drawingPrices(d)}</span>
        </span>
        <button type="button" onClick={onDone} className="tap text-[12.5px] font-semibold" style={{ color: "var(--c1)" }}>Done</button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = d.label === p.label;
          return (
            <button key={p.label} type="button" aria-pressed={on}
                    onClick={() => onChange({ label: p.label, color: p.color as DrawColor })}
                    className="rounded-full px-2.5 py-1 text-[12.5px] font-medium"
                    style={on
                      ? { background: `color-mix(in srgb, var(${colorToken(p.color)}) 16%, transparent)`, color: `var(${colorToken(p.color)})`, boxShadow: `inset 0 0 0 1.5px var(${colorToken(p.color)})` }
                      : { background: "var(--s3)", color: "var(--ink2)" }}>
              {p.label}
            </button>
          );
        })}
      </div>

      <input
        value={d.label}
        onChange={(e) => onChange({ label: e.target.value.slice(0, isNote ? NOTE_MAX : LABEL_MAX) })}
        autoFocus={isNote && !d.label}
        placeholder={isNote ? "What happened here? e.g. swept the Asian low" : "Or name it yourself"}
        aria-label={isNote ? "Note" : "Name"}
        className="w-full rounded-lg px-3 py-2 text-[13.5px]"
        style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Colour">
          {DRAW_COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={(d.color ?? "amber") === c}
                    onClick={() => onChange({ color: c })}
                    className="h-7 w-7 rounded-full"
                    style={{
                      background: `var(${colorToken(c)})`,
                      boxShadow: (d.color ?? "amber") === c ? "0 0 0 2px var(--s2), 0 0 0 4px var(--ink)" : undefined,
                    }} />
          ))}
        </div>
        {(d.kind === "box" || d.kind === "trend") && (
          <button type="button" aria-pressed={!!d.extend} onClick={() => onChange({ extend: !d.extend })}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium"
                  style={d.extend ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)", color: "var(--ink)" }}>
            Extend right
          </button>
        )}
        <button type="button" onClick={onDelete} className="tap ml-auto text-[12.5px] font-semibold" style={{ color: "var(--loss)" }}>
          Delete
        </button>
      </div>
      <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
        Drag the round handles to adjust{d.kind === "level" || d.kind === "note" ? "" : " the ends"}, or the outline to move it.
      </p>
    </div>
  );
}

function ToolIcon({ tool }: { tool: Tool }) {
  const common = { "aria-hidden": true, width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "level": return <svg {...common}><path d="M1.5 8h13" strokeDasharray="2.5 2" /></svg>;
    case "zone": return <svg {...common}><rect x="1.5" y="5" width="13" height="6" rx="1" /></svg>;
    case "box": return <svg {...common}><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></svg>;
    case "trend": return <svg {...common}><path d="M2.5 13 13.5 3" /><circle cx="2.5" cy="13" r="1.4" fill="currentColor" /><circle cx="13.5" cy="3" r="1.4" fill="currentColor" /></svg>;
    case "note": return <svg {...common}><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></svg>;
  }
}
