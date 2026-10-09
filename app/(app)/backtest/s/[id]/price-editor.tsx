"use client";

import { useEffect, useRef, useState } from "react";

export type PriceKey = "sl" | "tp" | "price";
export interface PriceField { key: PriceKey; label: string; value: number | null }

const num = (v: string) => { const n = Number(v.replace(",", ".")); return v.trim() === "" || !Number.isFinite(n) ? null : n; };

/**
 * Type an exact price for a stop, a target or an order — MT5's "Modify"
 * dialog, opened by double-clicking a line's label (or clicking its SL / TP
 * button). It sits beside the label; Enter applies, Esc or a click elsewhere
 * cancels, and each level shows what it would be worth before it is set.
 */
export function PriceEditor({ at, title, fields, decimals, preview, onCommit, onCancel }: {
  at: { x: number; y: number };
  title: string;
  fields: PriceField[];
  decimals: number;
  preview: (key: PriceKey, price: number) => string | null;
  onCommit: (values: Partial<Record<PriceKey, number | null>>) => string | null;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value === null ? "" : f.value.toFixed(decimals)])));
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) onCancel(); };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onCancel]);

  const apply = (override?: Partial<Record<PriceKey, number | null>>) => {
    const out: Partial<Record<PriceKey, number | null>> = {};
    for (const f of fields) {
      const v = override && f.key in override ? override[f.key]! : num(values[f.key] ?? "");
      if (v !== f.value) out[f.key] = v;
    }
    if (!Object.keys(out).length) return onCancel();
    const err = onCommit(out);
    if (err) setError(err);
  };

  const w = 248;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const height = 92 + fields.length * 58;
  const left = Math.min(Math.max(8, at.x - w - 8), vw - w - 8);
  // Above the line when the keyboard would cover it.
  const top = at.y + height + 12 > vh ? Math.max(8, at.y - height - 12) : at.y + 12;

  return (
    <div ref={box} role="dialog" aria-label={title} className="fixed z-[80] rounded-xl p-3"
         style={{ left, top, width: w, background: "var(--s1)", border: "1px solid var(--line)", boxShadow: "0 8px 28px rgb(0 0 0 / 0.22)" }}>
      <div className="mb-2 truncate text-[12.5px] font-semibold">{title}</div>
      <div className="space-y-2">
        {fields.map((f, i) => {
          const v = num(values[f.key] ?? "");
          const hint = v !== null ? preview(f.key, v) : null;
          return (
            <label key={f.key} className="block">
              <span className="mb-1 flex items-center text-[11.5px] font-medium" style={{ color: "var(--ink3)" }}>
                {f.label}
                {f.key !== "price" && f.value !== null && (
                  <button type="button" className="ml-auto text-[11.5px] font-semibold" style={{ color: "var(--loss)" }}
                          onClick={(e) => { e.preventDefault(); apply({ [f.key]: null }); }}>Remove</button>
                )}
              </span>
              <input ref={i === 0 ? first : undefined} inputMode="decimal" value={values[f.key] ?? ""} aria-label={f.label}
                     onChange={(e) => { setValues((s) => ({ ...s, [f.key]: e.target.value })); setError(null); }}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") { e.preventDefault(); apply(); }
                       if (e.key === "Escape") { e.preventDefault(); onCancel(); }
                     }}
                     placeholder="none"
                     className="num h-9 w-full rounded-lg px-2.5 text-[13.5px]" style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
              {hint && <span className="num mt-0.5 block text-[11px]" style={{ color: "var(--ink3)" }}>{hint}</span>}
            </label>
          );
        })}
      </div>
      {error && <p className="mt-2 text-[12px]" style={{ color: "var(--loss)" }} role="alert">{error}</p>}
      <div className="mt-2.5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost !px-2 !py-1 !text-[12.5px]">Cancel</button>
        <button type="button" onClick={() => apply()} className="btn btn-primary !px-3 !py-1 !text-[12.5px]">Apply</button>
      </div>
    </div>
  );
}
