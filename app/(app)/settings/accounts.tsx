"use client";

import { useActionState, useState } from "react";
import { createAccount, deleteAccount, renameAccount, switchAccount } from "@/lib/actions";

export interface AccountRow {
  id: string;
  nickname: string;
  broker: string;
  currency: string;
  kind: string;
  trades: number;
  active: boolean;
}

const KINDS = [
  { value: "live", label: "Live" },
  { value: "demo", label: "Demo" },
  { value: "cent", label: "Cent" },
  { value: "prop", label: "Prop / funded" },
];

/**
 * More than one journal, under one login.
 *
 * The schema always allowed it; the interface assumed one. The case that makes
 * it worth building is not vanity — it is that averaging a demo run into a live
 * one produces a number describing neither, and a funded account with different
 * size and different rules is a different trader's results in the same person's
 * hands.
 */
export function Accounts({ accounts }: { accounts: AccountRow[] }) {
  const [createState, create, creating] = useActionState(createAccount, null);
  const [, use] = useActionState(switchAccount, null);
  const [renameState, rename] = useActionState(renameAccount, null);
  const [deleteState, remove] = useActionState(deleteAccount, null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-4 space-y-3">
      <ul className="space-y-2">
        {accounts.map((a) => (
          <li key={a.id} className="rounded-lg p-3"
              style={{
                background: a.active ? "var(--s3)" : "var(--s1)",
                border: `1px solid ${a.active ? "var(--ink3)" : "var(--line)"}`,
              }}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{a.nickname}</span>
              {a.active && (
                <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                      style={{ background: "var(--ink)", color: "var(--plane)" }}>showing</span>
              )}
              {a.kind !== "live" && (
                <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                      style={{ background: "var(--s1)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
                  {a.kind}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink3)" }}>
              {a.broker} · {a.currency} · {a.trades.toLocaleString("en-US")}{" "}
              {a.trades === 1 ? "trade" : "trades"}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px]">
              {!a.active && (
                <form action={use}>
                  <input type="hidden" name="accountId" value={a.id} />
                  <button type="submit" className="tap font-semibold" style={{ color: "var(--c1)" }}>
                    Show this one
                  </button>
                </form>
              )}
              <button type="button" className="tap" style={{ color: "var(--ink3)" }}
                      onClick={() => { setEditing(editing === a.id ? null : a.id); setDeleting(null); }}>
                Rename
              </button>
              {accounts.length > 1 && (
                <button type="button" className="tap" style={{ color: "var(--loss)" }}
                        onClick={() => { setDeleting(deleting === a.id ? null : a.id); setEditing(null); }}>
                  Delete
                </button>
              )}
            </div>

            {editing === a.id && (
              <form action={rename} className="mt-2 flex flex-col gap-2 sm:flex-row"
                    onSubmit={() => setEditing(null)}>
                <input type="hidden" name="accountId" value={a.id} />
                <input name="nickname" defaultValue={a.nickname} maxLength={40}
                       className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px]"
                       style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
                <button type="submit" className="shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                        style={{ background: "var(--ink)", color: "var(--plane)" }}>Save</button>
              </form>
            )}

            {deleting === a.id && (
              <form action={remove} className="mt-2 space-y-2">
                <input type="hidden" name="accountId" value={a.id} />
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
                  This removes <b>{a.trades.toLocaleString("en-US")} trades</b> and everything
                  written about them — notes, mark-up, screenshots — and cannot be undone. Type{" "}
                  <b>{a.nickname}</b> to confirm.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input name="confirm" autoComplete="off" placeholder={a.nickname}
                         className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px]"
                         style={{ background: "var(--s2)", border: "1px solid var(--loss)", color: "var(--ink)" }} />
                  <button type="submit" className="shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                          style={{ background: "var(--loss)", color: "#fff" }}>
                    Delete permanently
                  </button>
                </div>
                {deleteState?.error && (
                  <p className="text-[12.5px]" style={{ color: "var(--loss)" }}>{deleteState.error}</p>
                )}
              </form>
            )}
          </li>
        ))}
      </ul>

      {renameState?.error && (
        <p className="text-[12.5px]" style={{ color: "var(--loss)" }}>{renameState.error}</p>
      )}

      {adding ? (
        <form action={create} className="space-y-2 rounded-lg p-3"
              style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input name="nickname" placeholder="Name it (Live, Demo, Prop…)" maxLength={40}
                   className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px]"
                   style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
            <input name="broker" placeholder="Broker" maxLength={40}
                   className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px]"
                   style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select name="accountKind" defaultValue="live"
                    className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px]"
                    style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input name="currency" defaultValue="USD" maxLength={3}
                   className="w-full rounded-lg px-3 py-2 text-[13px] uppercase sm:w-24"
                   style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }} />
            <button type="submit" disabled={creating}
                    className="shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold"
                    style={{ background: "var(--ink)", color: "var(--plane)", opacity: creating ? 0.6 : 1 }}>
              {creating ? "Adding…" : "Add"}
            </button>
          </div>
          {createState?.error && (
            <p className="text-[12.5px]" style={{ color: "var(--loss)" }}>{createState.error}</p>
          )}
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
                className="tap text-[13px] font-semibold" style={{ color: "var(--c1)" }}>
          Add another account →
        </button>
      )}
    </div>
  );
}
