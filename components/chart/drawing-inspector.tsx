"use client";

import { useEffect, useRef, useState } from "react";
import type { Drawing, DrawingStyle, LevelDef } from "lightweight-charts-drawing";
import { defaultStyleFor } from "lightweight-charts-drawing";
import { SWATCHES, toolLabel } from "@/lib/chart/kit";

/** Kinds whose words are the drawing itself, kept in `text`; everything else labels the line with style.text. */
const TEXT_KINDS = new Set(["text", "note", "comment", "price-note", "signpost", "callout", "pin"]);

const WIDTHS = [1, 2, 3, 4];
const LINE_STYLES: DrawingStyle["lineStyle"][] = ["solid", "dashed", "dotted"];

/**
 * The bar that appears when one drawing is selected: colour, thickness, line
 * style, its words, lock, hide, copy, settings, delete — the floating toolbar
 * a TradingView user reaches for, laid out as a plain row so it works the same
 * under a finger as under a mouse.
 */
export function SelectionBar({ d, presets = [], onChange, onDelete, onDuplicate, onSettings, onDone }: {
  d: Drawing;
  /** One-tap names with their colour, for the kinds of drawing that have them. */
  presets?: { label: string; color: string }[];
  onChange: (next: Drawing) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSettings: () => void;
  onDone: () => void;
}) {
  const [palette, setPalette] = useState(false);
  const isText = TEXT_KINDS.has(d.kind);
  const words = isText ? d.text ?? "" : d.style.text ?? "";
  const withWords = (x: Drawing, v: string): Drawing => (isText ? { ...x, text: v } : { ...x, style: { ...x.style, text: v } });
  const withColour = (x: Drawing, c: string): Drawing => {
    const s = x.style;
    return {
      ...x,
      style: {
        ...s, color: c,
        // A fill that matched the outline keeps matching it.
        ...(s.backgroundColor === undefined || s.backgroundColor === s.color ? { backgroundColor: c } : {}),
        ...(s.textColor !== undefined && s.textColor === s.color ? { textColor: c } : {}),
      },
    };
  };
  const setWords = (v: string) => onChange(withWords(d, v));
  const setColour = (c: string) => onChange(withColour(d, c));
  const next = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length];

  return (
    <div className="relative rounded-xl p-2" style={{ background: "var(--s2)", border: "1px solid var(--line)" }} aria-label="Selected drawing">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-1 text-[12.5px] font-semibold">{toolLabel(d.kind)}</span>
        <button type="button" aria-label="Colour" onClick={() => setPalette((p) => !p)}
                className="h-8 w-8 rounded-lg" style={{ background: d.style.color, boxShadow: "inset 0 0 0 2px var(--s1), 0 0 0 1px var(--line)" }} />
        <button type="button" aria-label={`Thickness ${d.style.width}`} title="Thickness" onClick={() => onChange({ ...d, style: { ...d.style, width: next(WIDTHS, d.style.width) } })}
                className="flex h-8 w-10 items-center justify-center rounded-lg" style={{ background: "var(--s3)" }}>
          <span className="block w-6 rounded-full" style={{ height: d.style.width, background: "var(--ink)" }} />
        </button>
        <button type="button" aria-label={`Line style ${d.style.lineStyle}`} title="Line style" onClick={() => onChange({ ...d, style: { ...d.style, lineStyle: next(LINE_STYLES, d.style.lineStyle) } })}
                className="flex h-8 w-10 items-center justify-center rounded-lg" style={{ background: "var(--s3)" }}>
          <span className="block w-6" style={{ borderTop: `2px ${d.style.lineStyle} var(--ink)` }} />
        </button>
        <Mini label={d.locked ? "Unlock" : "Lock"} on={!!d.locked} onClick={() => onChange({ ...d, locked: !d.locked } as Drawing)}>
          {d.locked
            ? <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" />
            : <path d="M4.5 7V5a3.5 3.5 0 0 1 6.8-1.2M3.5 7h9v6.5h-9z" />}
        </Mini>
        <Mini label="Copy" onClick={onDuplicate}><path d="M5.5 5.5h8v8h-8zM2.5 10.5v-8h8" /></Mini>
        <Mini label="Settings" onClick={onSettings}><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></Mini>
        <Mini label="Delete" danger onClick={onDelete}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" /></Mini>
        <button type="button" onClick={onDone} className="tap ml-auto px-2 text-[12.5px] font-semibold" style={{ color: "var(--c1)" }}>Done</button>
      </div>
      {/* The words get a row of their own: squeezed in beside the buttons they
          had room for four letters on a phone. */}
      <input value={words} onChange={(e) => setWords(e.target.value.slice(0, 200))}
             placeholder={isText ? "Text" : "Label (optional)"} aria-label={isText ? "Text" : "Label"}
             className="mt-2 h-9 w-full rounded-lg px-2.5 text-[13.5px] md:max-w-sm"
             style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }} />
      {presets.length > 0 && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto sm:flex-wrap" role="group" aria-label="Quick names">
          {presets.map((p) => {
            const on = words === p.label;
            return (
              <button key={p.label} type="button" aria-pressed={on}
                      onClick={() => onChange(withColour(withWords(d, on ? "" : p.label), p.color))}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-medium"
                      style={on
                        ? { background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: p.color, boxShadow: `inset 0 0 0 1.5px ${p.color}` }
                        : { background: "var(--s3)", color: "var(--ink2)" }}>
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      {palette && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Colours">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={c === d.style.color} onClick={() => { setColour(c); setPalette(false); }}
                    className="h-8 w-8 rounded-full"
                    style={{ background: c, boxShadow: c === d.style.color ? "0 0 0 2px var(--s2), 0 0 0 4px var(--ink)" : "inset 0 0 0 1px rgb(0 0 0 / 0.15)" }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({ label, onClick, on, danger, children }: { label: string; onClick: () => void; on?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} onClick={onClick}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={on ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)", color: danger ? "var(--loss)" : "var(--ink)" }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
    </button>
  );
}

/** Settings a trader actually changes, in words; only those the tool has are shown. */
const TOGGLES: [keyof DrawingStyle, string][] = [
  ["extendLeft", "Extend left"], ["extendRight", "Extend right"], ["fillBackground", "Fill"],
  ["showPriceLabels", "Price labels on the axis"], ["showMiddlePoint", "Middle point"], ["showStats", "Show stats"],
  ["showText", "Level labels"], ["fibLevelsAsPercents", "Levels as percentages"], ["reverse", "Reverse"],
  ["extendLines", "Extend lines"], ["showPriceRange", "Price change"], ["showBarsRange", "Bars"],
  ["showDateTimeRange", "Duration"], ["drawBorder", "Border"], ["bold", "Bold"], ["italic", "Italic"],
];
const NUMBERS: [keyof DrawingStyle, string, number, number, number][] = [
  ["transparency", "Fill transparency", 0, 100, 1], ["fontSize", "Text size", 8, 40, 1],
  ["accountSize", "Account size", 1, 10_000_000, 1], ["riskPercent", "Risk %", 0.01, 100, 0.01], ["lotSize", "Contract size", 0.0001, 1_000_000, 0.0001],
];

export function SettingsSheet({ d, onChange, onClose }: { d: Drawing; onChange: (next: Drawing) => void; onClose: () => void }) {
  const factory = defaultStyleFor(d.kind) as DrawingStyle;
  const has = (k: keyof DrawingStyle) => k in d.style || k in factory;
  const set = (patch: Partial<DrawingStyle>) => onChange({ ...d, style: { ...d.style, ...patch } });
  const levels = (d.style.levels ?? factory.levels) as LevelDef[] | undefined;
  const middle = (d.style as { rectMiddleLine?: { visible: boolean } }).rectMiddleLine;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center md:items-center" role="dialog" aria-label={`${toolLabel(d.kind)} settings`}>
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: "rgb(0 0 0 / 0.4)" }} onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 md:rounded-2xl"
           style={{ background: "var(--s1)", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        <div className="mb-3 flex items-center">
          <span className="text-[15px] font-semibold">{toolLabel(d.kind)}</span>
          <button type="button" onClick={onClose} className="tap ml-auto text-[13px] font-semibold" style={{ color: "var(--c1)" }}>Done</button>
        </div>
        <div className="space-y-1">
          {middle && (
            <Toggle label="Middle line (50%)" on={middle.visible}
                    onChange={(v) => onChange({ ...d, style: { ...d.style, rectMiddleLine: { ...middle, visible: v } } as DrawingStyle })} />
          )}
          {TOGGLES.filter(([k]) => has(k)).map(([k, label]) => (
            <Toggle key={k} label={label} on={!!(d.style[k] ?? factory[k])} onChange={(v) => set({ [k]: v } as Partial<DrawingStyle>)} />
          ))}
          {NUMBERS.filter(([k]) => has(k)).map(([k, label, min, max, step]) => (
            <label key={k} className="flex items-center gap-3 rounded-lg px-1 py-2 text-[13.5px]">
              <span className="flex-1">{label}</span>
              <input type="number" min={min} max={max} step={step} value={Number(d.style[k] ?? factory[k] ?? 0)}
                     onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ [k]: Math.min(max, Math.max(min, v)) } as Partial<DrawingStyle>); }}
                     className="num w-28 rounded-lg px-2 py-1.5 text-right text-[13px]"
                     style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
            </label>
          ))}
        </div>
        {levels && levels.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Levels</div>
            <div className="space-y-1">
              {levels.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="checkbox" style={{ accentColor: "var(--c1)" }} checked={l.visible} aria-label={`Show level ${l.coeff}`}
                         onChange={(e) => set({ levels: levels.map((x, k) => (k === i ? { ...x, visible: e.target.checked } : x)) })}
                         className="h-4 w-4" />
                  <input type="number" step="0.001" value={l.coeff} aria-label="Level"
                         onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ levels: levels.map((x, k) => (k === i ? { ...x, coeff: v } : x)) }); }}
                         className="num w-24 rounded-lg px-2 py-1 text-[13px]" style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
                  <span className="h-5 w-5 rounded-full" style={{ background: l.color }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
            className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-[13.5px]">
      <span className="flex-1">{label}</span>
      <span className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
            style={{ background: on ? "var(--c1)" : "var(--s3)", boxShadow: on ? undefined : "inset 0 0 0 1px var(--line)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-150"
              style={{ left: on ? 18 : 2, background: "#fff", boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)" }} />
      </span>
    </button>
  );
}

/** Every drawing on this chart: find one, hide it, lock it, remove it. */
export function ObjectsPanel({ drawings, selected, onSelect, onChange, onRemove, onClear, onClose }: {
  drawings: readonly Drawing[];
  selected: readonly string[];
  onSelect: (id: string) => void;
  onChange: (d: Drawing) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-xl p-2" style={{ background: "var(--s2)", border: "1px solid var(--line)" }} aria-label="Your drawings">
      <div className="flex items-center px-1 pb-1">
        <span className="text-[13px] font-semibold">Your drawings</span>
        <span className="num ml-2 text-[12px]" style={{ color: "var(--ink3)" }}>{drawings.length}</span>
        {drawings.length > 0 && (
          <button type="button" onClick={() => (confirm ? (onClear(), setConfirm(false)) : setConfirm(true))}
                  className="tap ml-auto text-[12.5px] font-semibold" style={{ color: "var(--loss)" }}>
            {confirm ? "Remove all?" : "Remove all"}
          </button>
        )}
        <button type="button" onClick={onClose} className={`tap text-[12.5px] font-semibold ${drawings.length ? "ml-3" : "ml-auto"}`} style={{ color: "var(--c1)" }}>Done</button>
      </div>
      {drawings.length === 0 && <p className="px-1 py-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>Nothing drawn yet.</p>}
      <ul className="max-h-64 overflow-y-auto">
        {[...drawings].reverse().map((d) => (
          <li key={d.id} className="flex items-center gap-1 rounded-lg"
              style={selected.includes(d.id) ? { background: "var(--s3)" } : undefined}>
            <button type="button" onClick={() => onSelect(d.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.style.color }} />
              <span className="truncate text-[13px]" style={{ opacity: d.hidden ? 0.5 : 1 }}>
                {toolLabel(d.kind)}{(d.text || d.style.text) ? <span style={{ color: "var(--ink3)" }}> · {d.text || d.style.text}</span> : null}
              </span>
            </button>
            <RowIcon label={d.hidden ? "Show" : "Hide"} on={!!d.hidden} onClick={() => onChange({ ...d, hidden: !d.hidden } as Drawing)}>
              {d.hidden
                ? <path d="M2 2l12 12M6.5 4a6.5 6.5 0 0 1 1.5-.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.6M4 5.4A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.4-.5" />
                : <><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>}
            </RowIcon>
            <RowIcon label={d.locked ? "Unlock" : "Lock"} on={!!d.locked} onClick={() => onChange({ ...d, locked: !d.locked } as Drawing)}>
              {d.locked
                ? <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" />
                : <path d="M4.5 7V5a3.5 3.5 0 0 1 6.8-1.2M3.5 7h9v6.5h-9z" />}
            </RowIcon>
            <RowIcon label="Remove" danger onClick={() => onRemove(d.id)}><path d="M4 4l8 8M12 4l-8 8" /></RowIcon>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowIcon({ label, onClick, on, danger, children }: { label: string; onClick: () => void; on?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} onClick={onClick}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ color: danger ? "var(--loss)" : on ? "var(--ink)" : "var(--ink3)" }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
    </button>
  );
}

/** The kit asks the host for a text editor when a text tool is placed or double-clicked. */
export function TextEditor({ at, initial, onCommit, onCancel }: {
  at: { x: number; y: number };
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const left = Math.min(Math.max(8, at.x), (typeof window !== "undefined" ? window.innerWidth : 400) - 248);
  return (
    <div className="fixed z-[80] w-60 rounded-xl p-2" style={{ left, top: at.y + 12, background: "var(--s1)", border: "1px solid var(--line)", boxShadow: "0 8px 28px rgb(0 0 0 / 0.22)" }}>
      <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value.slice(0, 500))} rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommit(v); }
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="What is this?" aria-label="Drawing text"
                className="w-full resize-none rounded-lg p-2 text-[13.5px]" style={{ background: "var(--s2)", color: "var(--ink)", border: "1px solid var(--line)" }} />
      <div className="mt-1.5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost !px-2 !py-1 !text-[12.5px]">Cancel</button>
        <button type="button" onClick={() => onCommit(v)} className="btn btn-primary !px-3 !py-1 !text-[12.5px]">Save</button>
      </div>
    </div>
  );
}
