"use client";

import { useState, useTransition } from "react";
import { saveWeeklyNote } from "@/lib/actions";

interface Existing {
  wentWell: string | null;
  toFix: string | null;
  focus: string | null;
}

const FIELDS = [
  { name: "wentWell", label: "What worked", hint: "The thing you would want to do again." },
  { name: "toFix", label: "What did not", hint: "Be specific. “I chased three entries on Thursday” beats “bad week”." },
  { name: "focus", label: "One thing to change next week", hint: "One. A list of five changes is a list of no changes." },
] as const;

/**
 * Saved on demand rather than on every keystroke.
 *
 * A review is written in one sitting and then left alone, so an explicit save
 * with a plain confirmation is both cheaper and clearer than autosave — which
 * on a flaky mobile connection mostly produces uncertainty about whether the
 * thing you just typed is safe.
 */
export function WeekNote({ weekStart, existing }: { weekStart: string; existing: Existing | null }) {
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(form) => start(async () => { await saveWeeklyNote(weekStart, form); setSaved(true); })}
      onChange={() => setSaved(false)}
    >
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="text-[13px] font-semibold">{f.label}</label>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>{f.hint}</p>
          <textarea
            id={f.name} name={f.name} rows={f.name === "focus" ? 2 : 3} maxLength={2000}
            defaultValue={existing?.[f.name] ?? ""}
            className="mt-1.5 w-full resize-y rounded-lg px-3 py-2.5 text-[13px] leading-relaxed"
            style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
                className="rounded-lg px-4 py-2.5 text-[13px] font-semibold"
                style={{ background: "var(--ink)", color: "var(--plane)", opacity: pending ? 0.6 : 1 }}>
          {pending ? "Saving…" : "Save review"}
        </button>
        {saved && !pending && <span className="text-[12.5px] pos">Saved</span>}
      </div>
    </form>
  );
}
