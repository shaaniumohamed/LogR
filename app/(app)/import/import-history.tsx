"use client";

import { useActionState, useState } from "react";
import { clearHistory, undoImport, type ImportSummary } from "@/lib/actions";

/** The date a person recognises a file by, not the one a machine stores. */
const day = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—";

const money = (n: number) =>
  `${n < 0 ? "−⁠" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * What has been imported, and the way back out.
 *
 * Every import is listed with the dates it covers and what it added to the
 * balance, because that is how a trader recognises which file was which — the
 * broker names them all something like `orders_history.csv`, and three of them
 * in a downloads folder are indistinguishable by name alone.
 */
export function ImportHistory({ imports, accountName }: { imports: ImportSummary[]; accountName: string }) {
  const [undoState, undo, undoing] = useActionState(undoImport, null);
  const [clearState, clear, clearing] = useActionState(clearHistory, null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);

  if (!imports.length) return null;

  return (
    <div className="card p-5">
      <div className="eyebrow">Files you have imported</div>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        Imported the wrong file? Remove it and everything goes back to how it was.
      </p>

      <ul className="mt-3 space-y-2">
        {imports.map((b) => (
          <li key={b.id} className="rounded-lg p-3" style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                {b.filename || "Imported file"}
              </span>
              <span className="num text-[12.5px] font-semibold"
                    style={{ color: b.net >= 0 ? "var(--profit)" : "var(--loss)" }}>
                {money(b.net)}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              {b.added.toLocaleString("en-US")} {b.added === 1 ? "trade" : "trades"} · {day(b.from)} to {day(b.to)}
            </div>

            {confirming === b.id ? (
              <form action={undo} className="mt-2.5 flex flex-wrap items-center gap-2">
                <input type="hidden" name="batchId" value={b.id} />
                <span className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                  Remove these {b.added.toLocaleString("en-US")} trades?
                </span>
                <button type="submit" disabled={undoing}
                        className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                        style={{ background: "var(--loss)", color: "var(--plane)", opacity: undoing ? 0.6 : 1 }}>
                  {undoing ? "Removing…" : "Remove"}
                </button>
                <button type="button" onClick={() => setConfirming(null)}
                        className="tap text-[12.5px]" style={{ color: "var(--ink3)" }}>
                  Keep
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setConfirming(b.id)}
                      className="tap mt-1.5 text-[12.5px] font-semibold" style={{ color: "var(--ink3)" }}>
                Remove this import
              </button>
            )}
          </li>
        ))}
      </ul>

      {undoState?.ok && <p className="mt-3 text-[12.5px]" style={{ color: "var(--profit)" }}>{undoState.ok}</p>}
      {undoState?.error && <p className="mt-3 text-[12.5px]" style={{ color: "var(--loss)" }}>{undoState.error}</p>}

      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        {wiping ? (
          <form action={clear} className="space-y-2">
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
              This deletes every trade on <b>{accountName}</b>. Your notes and screenshots stay, and
              reattach if you import the same trades again. Type <b>{accountName}</b> to confirm.
            </p>
            <div className="flex flex-wrap gap-2">
              <input name="confirm" autoComplete="off" placeholder={accountName}
                     className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-[13px]"
                     style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
              <button type="submit" disabled={clearing}
                      className="shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold"
                      style={{ background: "var(--loss)", color: "var(--plane)", opacity: clearing ? 0.6 : 1 }}>
                {clearing ? "Clearing…" : "Delete everything"}
              </button>
              <button type="button" onClick={() => setWiping(false)}
                      className="tap shrink-0 text-[13px]" style={{ color: "var(--ink3)" }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setWiping(true)}
                  className="tap text-[12.5px] font-semibold" style={{ color: "var(--ink3)" }}>
            Start this account over
          </button>
        )}
        {clearState?.ok && <p className="mt-2 text-[12.5px]" style={{ color: "var(--profit)" }}>{clearState.ok}</p>}
        {clearState?.error && <p className="mt-2 text-[12.5px]" style={{ color: "var(--loss)" }}>{clearState.error}</p>}
      </div>
    </div>
  );
}
