"use client";

import { useActionState, useState } from "react";
import { addRule, setRuleActive } from "@/lib/actions";
import { RULE_SUGGESTIONS } from "@/lib/core/taxonomy";

export interface RuleRow {
  id: string;
  text: string;
  active: boolean;
  /** Annotated trades that broke it, and what they came to. */
  broken: number;
  cost: number;
  /** Annotated trades in force for this rule at all. */
  judged: number;
}

const money0 = (n: number) => `${n < 0 ? "−⁠" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/**
 * The rules, and what breaking each one has cost.
 *
 * Everything else in this app is descriptive — here is what happened, here is
 * what it was worth. A rule is the one prescriptive thing in it, and it is what
 * turns a finding into a habit: the pattern says late entries lose money, the
 * rule says do not take them, and the number beside the rule says whether that
 * is being followed.
 */
export function Rules({ rules }: { rules: RuleRow[] }) {
  const [addState, add, adding] = useActionState(addRule, null);
  const [, toggle] = useActionState(setRuleActive, null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const active = rules.filter((r) => r.active);
  const retired = rules.filter((r) => !r.active);
  const taken = new Set(rules.map((r) => r.text.toLowerCase()));
  const suggestions = RULE_SUGGESTIONS.filter((t) => !taken.has(t.toLowerCase()));

  return (
    <div className="mt-4 space-y-4">
      {active.length > 0 && (
        <ul className="space-y-1.5">
          {active.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-snug">{r.text}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink3)" }}>
                  {r.judged === 0
                    ? "no annotated trades yet"
                    : r.broken === 0
                      ? `kept on all ${r.judged} you have written up`
                      : `broken ${r.broken} of ${r.judged} · those came to ${money0(r.cost)}`}
                </div>
              </div>
              <form action={toggle} className="shrink-0">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="active" value="false" />
                <button type="submit" className="tap text-[12px]" style={{ color: "var(--ink3)" }}>
                  Retire
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={add} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="text" maxLength={160} placeholder="Write a rule in your own words"
                 className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-[13px]"
                 style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
          <button type="submit" disabled={adding}
                  className="shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold"
                  style={{ background: "var(--ink)", color: "var(--plane)", opacity: adding ? 0.6 : 1 }}>
            {adding ? "Adding…" : "Add rule"}
          </button>
        </div>
        {addState?.error && (
          <p className="text-[12.5px]" style={{ color: "var(--loss)" }}>{addState.error}</p>
        )}
      </form>

      {suggestions.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowSuggestions((v) => !v)}
                  className="tap text-[12.5px] font-semibold" style={{ color: "var(--c1)" }}>
            {showSuggestions ? "Hide suggestions" : `Suggestions (${suggestions.length}) ›`}
          </button>
          {showSuggestions && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <form key={t} action={add}>
                  <input type="hidden" name="text" value={t} />
                  <button type="submit"
                          className="rounded-full px-3 py-1.5 text-left text-[12px] leading-snug"
                          style={{ background: "var(--s1)", border: "1px dashed var(--line)", color: "var(--ink2)" }}>
                    + {t}
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      )}

      {retired.length > 0 && (
        <details>
          <summary className="tap cursor-pointer list-none text-[12.5px] font-semibold"
                   style={{ color: "var(--ink3)" }}>
            Retired ({retired.length}) ›
          </summary>
          <ul className="mt-2 space-y-1.5">
            {retired.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                  style={{ background: "var(--s3)" }}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug" style={{ color: "var(--ink2)" }}>{r.text}</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink3)" }}>
                    still counted on the {r.judged} trades it was in force for
                  </div>
                </div>
                <form action={toggle} className="shrink-0">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="active" value="true" />
                  <button type="submit" className="tap text-[12px]" style={{ color: "var(--c1)" }}>
                    Bring back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
