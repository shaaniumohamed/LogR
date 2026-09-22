"use client";

import { useActionState } from "react";
import { inviteFriend, revokeInvite } from "@/lib/actions";
import type { Invite } from "@/lib/access";

/**
 * Handing out access without a redeploy.
 *
 * A client component only because both actions want to say something back —
 * "that is already an owner", "they can sign in now" — and a bare server form
 * would either say nothing or need a full page's worth of query-string state to
 * carry one sentence. Everything it can do is re-checked on the server.
 */
export function People({ invites, owners, gateOpen }: {
  invites: (Omit<Invite, "createdAt"> & { createdAt: string })[];
  owners: string[];
  gateOpen: boolean;
}) {
  const [addState, add, adding] = useActionState(inviteFriend, null);
  const [revokeState, revoke] = useActionState(revokeInvite, null);
  const message = addState ?? revokeState;

  return (
    <div className="mt-4 space-y-4">
      {gateOpen && (
        <div className="rounded-lg p-3 text-[12.5px] leading-relaxed"
             style={{ background: "var(--s3)", borderLeft: "3px solid var(--warn)", color: "var(--ink2)" }}>
          <b>Anyone with a Google account can sign in right now.</b> No owner is named, so the
          gate is open. Set <code className="num">OWNER_EMAILS</code> to your own address in
          your host&rsquo;s environment variables and redeploy — after that, only you and the
          people you invite here can get in.
        </div>
      )}

      <form action={add} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="email" type="email" inputMode="email" autoComplete="off"
            placeholder="their Google address"
            className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-[13px]"
            style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
          <input
            name="note" maxLength={60} placeholder="who they are (optional)"
            className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-[13px]"
            style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
          <button type="submit" disabled={adding}
                  className="shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold"
                  style={{ background: "var(--ink)", color: "var(--plane)", opacity: adding ? 0.6 : 1 }}>
            {adding ? "Adding…" : "Invite"}
          </button>
        </div>
        {message && (
          <p className="text-[12.5px]" style={{ color: message.error ? "var(--loss)" : "var(--profit)" }}>
            {message.error ?? message.ok}
          </p>
        )}
      </form>

      <ul className="space-y-1.5">
        {owners.map((email) => (
          <li key={email} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5"
              style={{ background: "var(--s3)" }}>
            <span className="num min-w-0 flex-1 truncate text-[13px] font-medium">{email}</span>
            <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                  style={{ background: "var(--s1)", color: "var(--ink2)" }}>owner</span>
          </li>
        ))}

        {invites.map((i) => (
          <li key={i.email} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5"
              style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
            <div className="min-w-0 flex-1">
              <div className="num truncate text-[13px] font-medium">{i.email}</div>
              <div className="truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                {i.note ? `${i.note} · ` : ""}
                {i.joined ? "signed in" : "not signed in yet"}
                {i.invitedByName ? ` · invited by ${i.invitedByName}` : ""}
              </div>
            </div>
            <form action={revoke} className="shrink-0">
              <input type="hidden" name="email" value={i.email} />
              <button type="submit" className="tap text-[12px]" style={{ color: "var(--ink3)" }}>
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>

      {invites.length === 0 && !gateOpen && (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Nobody else has been invited yet.
        </p>
      )}
    </div>
  );
}
