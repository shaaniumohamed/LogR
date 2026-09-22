"use client";

import { useActionState, useRef } from "react";
import { switchAccount } from "@/lib/actions";

export interface AccountOption { id: string; nickname: string; kind: string }

/**
 * Which journal you are looking at, in the header, only when there is a choice.
 *
 * Switching has to be one action from anywhere: a trader checking a demo run
 * against a live one does it several times in a sitting, and a trip through
 * Settings each way turns that into something they stop doing. Hidden entirely
 * for the single-account case, which is almost everybody, so the header stays
 * as quiet as it was.
 *
 * A native select rather than a menu: it is one tap on a phone, it opens as the
 * platform's own wheel, and it needs no code to be reachable by keyboard.
 */
export function AccountSwitcher({ accounts, activeId }: {
  accounts: AccountOption[];
  activeId: string;
}) {
  const [, act] = useActionState(switchAccount, null);
  const form = useRef<HTMLFormElement>(null);
  if (accounts.length < 2) return null;

  return (
    <form ref={form} action={act} className="min-w-0">
      <label className="sr-only" htmlFor="accountId">Trading account</label>
      {/*
        Keyed on the active account so a switch remounts it.
        An uncontrolled select keeps whatever the DOM node already had when
        React re-renders after the action, which left the box reading "Main"
        while the app was showing the demo — and worse, selecting "Main" again
        then fired no change event, so there was no way back.
      */}
      <select
        key={activeId}
        id="accountId" name="accountId" defaultValue={activeId}
        onChange={() => form.current?.requestSubmit()}
        className="w-full max-w-[128px] truncate rounded-lg px-2 py-1.5 text-[12px] font-medium sm:max-w-[180px]"
        style={{ background: "var(--s3)", border: "1px solid var(--line)", color: "var(--ink2)" }}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nickname}{a.kind !== "live" ? ` · ${a.kind}` : ""}
          </option>
        ))}
      </select>
    </form>
  );
}
