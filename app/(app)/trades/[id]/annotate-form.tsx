"use client";

import { useState, useTransition } from "react";
import { saveAnnotation } from "@/lib/actions";
import { CONFLUENCE_GROUPS, FEELINGS, MISTAKES, SETUPS, TIMEFRAMES } from "@/lib/core/taxonomy";

type Existing = {
  setup: string | null; timeframe: string | null; invalidation: number | null;
  confluences: string[]; mistakes: string[]; rulesBroken?: string[];
  emotion: string | null; note: string | null;
} | null;

export interface ActiveRule { id: string; text: string }

/** One tappable chip. Big enough for a thumb, and its state is never colour-only. */
function Chip({ name, value, label, hint, defaultChecked, tone }: {
  name: string; value: string; label: string; hint?: string;
  defaultChecked?: boolean; tone?: "good" | "bad";
}) {
  const [on, setOn] = useState(!!defaultChecked);
  const accent = tone === "bad" ? "var(--loss)" : tone === "good" ? "var(--profit)" : "var(--c1)";
  return (
    <label title={hint}
      className="inline-flex min-h-[38px] cursor-pointer select-none items-center rounded-2xl px-3.5 py-2 text-left text-[12.5px] leading-snug transition-colors"
      style={on
        ? { background: `color-mix(in srgb, ${accent} 16%, var(--s1))`, border: `1px solid color-mix(in srgb, ${accent} 55%, transparent)`, color: "var(--ink)", fontWeight: 600 }
        : { background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink2)" }}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked}
             className="sr-only" onChange={(e) => setOn(e.target.checked)} />
      {on && <span className="mr-1.5" aria-hidden>✓</span>}
      {label}
    </label>
  );
}

function Radio({ name, value, label, defaultChecked }: {
  name: string; value: string; label: string; defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex min-h-[38px] cursor-pointer select-none items-center rounded-full px-3.5 text-[12.5px] transition-colors
                      has-[:checked]:font-semibold"
           style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink2)" }}>
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="peer-checked:hidden">{label}</span>
      <span className="hidden peer-checked:inline" style={{ color: "var(--ink)" }}>✓ {label}</span>
    </label>
  );
}

export function AnnotateForm({ identityHash, existing, suggestedInvalidation, nextHref, rules }: {
  identityHash: string;
  existing: Existing;
  suggestedInvalidation: number;
  nextHref?: string;
  /** The rules in force, in the trader's own words. */
  rules: ActiveRule[];
}) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={(fd) => start(async () => {
        await saveAnnotation(identityHash, fd);
        setSaved(true);
        if (nextHref) window.location.href = nextHref;
      })}
      className="space-y-5"
    >
      <Field label="Which setup was it?">
        <div className="flex flex-wrap gap-2">
          {SETUPS.map((s) => <Radio key={s} name="setup" value={s} label={s} defaultChecked={existing?.setup === s} />)}
        </div>
      </Field>

      <Field label="Which timeframe did you read it on?">
        <div className="flex flex-wrap gap-2">
          {TIMEFRAMES.map((t) => <Radio key={t} name="timeframe" value={t} label={t} defaultChecked={existing?.timeframe === t} />)}
        </div>
      </Field>

      <Field
        label="Where was the idea dead?"
        help="The price that would have proved you wrong. This is the one number that makes R possible — without it, risk can only be guessed."
      >
        <div className="flex items-center gap-2">
          <input
            type="number" step="0.001" name="invalidation" inputMode="decimal"
            defaultValue={existing?.invalidation ?? ""}
            placeholder={suggestedInvalidation.toFixed(2)}
            className="num w-40 rounded-lg px-3 py-2.5 text-[15px]"
            style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
            suggested {suggestedInvalidation.toFixed(2)}
          </span>
        </div>
      </Field>

      <Field label="How did you feel taking it?" help="Pick the honest one. This is the half of a journal that numbers cannot supply.">
        <div className="flex flex-wrap gap-2">
          {FEELINGS.map((f) => (
            <Radio key={f.key} name="emotion" value={f.key} label={f.label} defaultChecked={existing?.emotion === f.key} />
          ))}
        </div>
      </Field>

      <Field label="What was in your favour?" help="Tick everything that was genuinely present — not what you wish had been.">
        <div className="space-y-3">
          {CONFLUENCE_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>
                {g.group}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.items.map((c) => (
                  <Chip key={c.key} name="confluences" value={c.key} label={c.label} hint={c.hint}
                        defaultChecked={existing?.confluences?.includes(c.key)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Field>

      <Field label="Anything you got wrong?" help="Left blank is fine. Tagging honestly here is what makes the cost of a habit visible.">
        <div className="flex flex-wrap gap-2">
          {MISTAKES.map((m) => (
            <Chip key={m.key} name="mistakes" value={m.key} label={m.label} hint={m.hint} tone="bad"
                  defaultChecked={existing?.mistakes?.includes(m.key)} />
          ))}
        </div>
      </Field>

      {rules.length > 0 && (
        <Field
          label="Did you break any of your own rules?"
          help="Your rules, in your words. Leaving one unticked counts as kept, so only tick what you actually broke."
        >
          <div className="flex flex-col gap-2">
            {rules.map((r) => (
              <Chip key={r.id} name="rulesBroken" value={r.id} label={r.text} tone="bad"
                    defaultChecked={existing?.rulesBroken?.includes(r.id)} />
            ))}
          </div>
        </Field>
      )}

      <Field label="Note">
        <textarea name="note" rows={3} defaultValue={existing?.note ?? ""}
                  placeholder="What did price do? Where was your zone? One line is plenty."
                  className="w-full rounded-lg px-3 py-2.5 text-[14px]"
                  style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
      </Field>

      <div className="sticky bottom-20 flex items-center gap-3 sm:bottom-4">
        <button type="submit" disabled={pending}
                className="flex-1 rounded-lg px-4 py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ background: "var(--ink)", color: "var(--plane)" }}>
          {pending ? "Saving…" : nextHref ? "Save and next trade" : "Save"}
        </button>
        {saved && !nextHref && <span className="text-[12.5px] pos">Saved</span>}
      </div>
    </form>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[13.5px] font-semibold">{label}</legend>
      {help && <p className="mt-0.5 mb-2 text-[12px] leading-relaxed" style={{ color: "var(--ink3)" }}>{help}</p>}
      <div className={help ? "" : "mt-2"}>{children}</div>
    </fieldset>
  );
}
