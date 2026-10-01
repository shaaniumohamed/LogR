"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveQuickNote } from "@/lib/actions";

export interface QuickTrade {
  id: string;
  /** "Sold XAUUSD" */
  title: string;
  /** "22 Sept, 04:27 · 3 entries" */
  meta: string;
  pnl: number;
  existing?: { setup: string | null; emotion: string | null; note: string | null; rulesBroken: string[] } | null;
}

export interface QuickOptions {
  setups: string[];
  feelings: { key: string; label: string; good: boolean }[];
  rules: { id: string; text: string }[];
}

const money = (n: number) =>
  `${n < 0 ? "−⁠" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The review queue, with a sheet instead of a page per trade.
 *
 * The full write-up is three screens of tags. That is the right tool for a
 * trade worth studying and the wrong one for the twenty that are waiting at the
 * end of a session — which is why most of them never get written up at all,
 * and why the psychology findings are thin exactly where they would matter.
 * Here each trade is three taps: what was the setup, how did you feel, did you
 * keep your rules. Save moves straight to the next one.
 */
export function QuickReviewList({ trades: fresh, options }: { trades: QuickTrade[]; options: QuickOptions }) {
  const [open, setOpen] = useState<number | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const router = useRouter();

  /*
   * The list holds still while the sheet is up.
   *
   * Every save re-renders the page on the server, and the trade just written
   * drops out of the queue — so the list the server sends back is shifted by
   * one. Following it mid-session would move the open sheet onto a different
   * trade from the one the trader is looking at. The new list is taken only
   * once the sheet is closed, which is also when the written ones should leave.
   */
  const [trades, setTrades] = useState(fresh);
  const [seen, setSeen] = useState(fresh);
  if (fresh !== seen && open === null) {
    setSeen(fresh);
    setTrades(fresh);
    setSaved(new Set());
  }

  const next = (from: number) => {
    for (let i = from + 1; i < trades.length; i++) if (!saved.has(trades[i].id)) return i;
    return null;
  };

  return (
    <>
      <ul className="mt-3">
        {trades.map((t, i) => {
          const done = saved.has(t.id);
          /*
           * The whole row opens the sheet: in this list, writing it up is the
           * only thing a tap can mean. The chart is one link away inside the
           * sheet for the trade that needs a second look.
           */
          return (
            <li key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
              <button type="button" onClick={() => setOpen(i)} disabled={done}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="num w-5 shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{i + 1}</span>
                <span className="h-7 w-1 shrink-0 rounded-full"
                      style={{ background: t.pnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{t.title}</span>
                  <span className="num block truncate text-[11px]" style={{ color: "var(--ink3)" }}>{t.meta}</span>
                </span>
                <span className={`num shrink-0 text-[14px] font-semibold ${t.pnl >= 0 ? "pos" : "neg"}`}>{money(t.pnl)}</span>
                {done
                  ? <span className="chip chip-profit shrink-0">Done</span>
                  : <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                          style={{ background: "var(--s3)", color: "var(--ink)" }}>Write up</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {open !== null && (
        <QuickSheet
          key={trades[open].id}
          trade={trades[open]}
          options={options}
          position={`${open + 1} of ${trades.length}`}
          hasNext={next(open) !== null}
          onClose={() => { setOpen(null); router.refresh(); }}
          onSaved={() => {
            const id = trades[open].id;
            setSaved((s) => new Set(s).add(id));
            const n = next(open);
            if (n === null) { setOpen(null); router.refresh(); } else setOpen(n);
          }}
        />
      )}
    </>
  );
}

/** One trade's three questions, as a sheet from the bottom of the screen. */
export function QuickSheet({ trade, options, position, hasNext, onClose, onSaved }: {
  trade: QuickTrade;
  options: QuickOptions;
  position?: string;
  hasNext?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(saveQuickNote, null);
  const [setup, setSetup] = useState(trade.existing?.setup ?? "");
  const [emotion, setEmotion] = useState(trade.existing?.emotion ?? "");
  const hadBroken = (trade.existing?.rulesBroken ?? []).length > 0;
  const [rules, setRules] = useState<"" | "kept" | "broke">(hadBroken ? "broke" : "");
  const [broken, setBroken] = useState<Set<string>>(new Set(trade.existing?.rulesBroken ?? []));
  const sheet = useRef<HTMLDivElement>(null);
  // The parent hands in fresh callbacks on every render; reading them through
  // a ref keeps the effects below from re-running (and re-focusing the sheet
  // out from under a half-typed note) each time it does.
  const handlers = useRef({ onClose, onSaved });
  useEffect(() => { handlers.current = { onClose, onSaved }; });

  // Saved: hand over to whoever opened the sheet, once.
  const done = useRef(false);
  useEffect(() => {
    if (state?.ok && !done.current) { done.current = true; handlers.current.onSaved(); }
  }, [state]);

  // The page underneath must not scroll while the sheet is up, and Escape
  // closes it — both things a sheet does everywhere else on a phone.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handlers.current.onClose(); };
    window.addEventListener("keydown", onKey);
    sheet.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, []);

  const needsRules = options.rules.length > 0;
  const rulesAnswered = !needsRules || rules === "kept" || (rules === "broke" && broken.size > 0);
  // Said out loud rather than left to a greyed-out button nobody can explain.
  const missing = [
    !setup && "the setup",
    !emotion && "how you felt",
    !rulesAnswered && (rules === "broke" ? "which rule" : "your rules"),
  ].filter(Boolean) as string[];
  if (missing.length > 1) missing.splice(-2, 2, `${missing.at(-2)} and ${missing.at(-1)}`);
  const canSave = !pending && missing.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true"
         aria-label={`Write up: ${trade.title}, ${trade.meta}`} data-trade={trade.id}>
      <button type="button" aria-label="Close" onClick={onClose}
              className="absolute inset-0" style={{ background: "rgb(0 0 0 / 0.42)" }} />
      <div ref={sheet} tabIndex={-1}
           className="relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-[22px] outline-none sm:mb-6 sm:rounded-[22px]"
           style={{ background: "var(--s1)", boxShadow: "0 -8px 40px rgb(0 0 0 / 0.18)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="sticky top-0 z-10 px-5 pb-3 pt-2.5" style={{ background: "var(--s1)" }}>
          <div className="mx-auto mb-3 h-1 w-9 rounded-full" style={{ background: "var(--line)" }} />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold">
                {trade.title} <span className={`num ${trade.pnl >= 0 ? "pos" : "neg"}`}>{money(trade.pnl)}</span>
              </div>
              <div className="num truncate text-[12px]" style={{ color: "var(--ink3)" }}>
                {trade.meta}{position && <> · {position}</>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="tap text-[13.5px] font-medium" style={{ color: "var(--ink3)" }}>Close</button>
          </div>
        </div>

        <form action={action} className="space-y-5 px-5 pb-5">
          <input type="hidden" name="identityHash" value={trade.id} />

          <Question n={1} title="What was the setup?">
            <Chips name="setup" value={setup} onChange={setSetup}
                   items={options.setups.map((s) => ({ value: s, label: s }))} />
          </Question>

          <Question n={2} title="How did you feel taking it?">
            <Chips name="emotion" value={emotion} onChange={setEmotion}
                   items={options.feelings.map((f) => ({ value: f.key, label: f.label, tone: f.good ? "good" : "bad" }))} />
          </Question>

          {needsRules && (
            <Question n={3} title="Did you keep your rules?">
              <input type="hidden" name="rules" value={rules} />
              <div className="grid grid-cols-2 gap-2">
                {([["kept", "Kept them all"], ["broke", "Broke one"]] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setRules(v)} aria-pressed={rules === v}
                          className="rounded-xl px-3 py-3 text-[14px] font-semibold transition-colors"
                          style={rules === v
                            ? { background: v === "kept" ? "var(--profit)" : "var(--loss)", color: "#fff" }
                            : { background: "var(--s3)", color: "var(--ink)" }}>
                    {label}
                  </button>
                ))}
              </div>
              {rules === "broke" && (
                <div className="mt-2 space-y-1.5">
                  {options.rules.map((r) => {
                    const on = broken.has(r.id);
                    return (
                      <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px]"
                             style={{ background: on ? "color-mix(in srgb, var(--loss) 12%, transparent)" : "var(--s3)" }}>
                        <input type="checkbox" name="rulesBroken" value={r.id} checked={on}
                               onChange={() => setBroken((s) => { const n = new Set(s); if (on) n.delete(r.id); else n.add(r.id); return n; })}
                               className="h-4 w-4 accent-[var(--loss)]" />
                        {r.text}
                      </label>
                    );
                  })}
                </div>
              )}
            </Question>
          )}

          <div>
            <label htmlFor="quick-note" className="text-[13px] font-medium" style={{ color: "var(--ink2)" }}>
              Anything worth remembering? <span style={{ color: "var(--ink3)" }}>Optional</span>
            </label>
            <input id="quick-note" name="note" defaultValue={trade.existing?.note ?? ""} autoComplete="off"
                   placeholder="One line is plenty"
                   className="mt-1.5 w-full rounded-xl px-3 py-2.5 text-[14px]"
                   style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
          </div>

          {state?.error
            ? <p className="text-[13px]" style={{ color: "var(--loss)" }}>{state.error}</p>
            : missing.length > 0 && (
              <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Still to answer: {missing.join(", ")}</p>
            )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canSave} className="btn btn-primary flex-1 !py-3 !text-[15px] disabled:opacity-40">
              {pending ? "Saving…" : hasNext ? "Save and next" : "Save"}
            </button>
            <Link href={`/trades/${trade.id}?from=review`} className="btn btn-ghost !px-2">Open the trade</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function Question({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 flex items-center gap-2 text-[14.5px] font-semibold">
        <span className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold"
              style={{ background: "var(--s3)", color: "var(--ink2)" }}>{n}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Single choice as chips. Tapping the chosen one again clears it. */
function Chips({ name, value, onChange, items }: {
  name: string; value: string; onChange: (v: string) => void;
  items: { value: string; label: string; tone?: "good" | "bad" }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <input type="hidden" name={name} value={value} />
      {items.map((it) => {
        const on = it.value === value;
        const tint = it.tone === "bad" ? "var(--loss)" : it.tone === "good" ? "var(--profit)" : "var(--ink)";
        return (
          <button key={it.value} type="button" aria-pressed={on} onClick={() => onChange(on ? "" : it.value)}
                  className="rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors"
                  style={on
                    ? { background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint, boxShadow: `inset 0 0 0 1.5px ${tint}` }
                    : { background: "var(--s3)", color: "var(--ink2)" }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
