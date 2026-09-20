"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Fetch the candles for this trade's day, from the review screen.
 *
 * Here rather than only on the import page because this is the moment the gap
 * is felt: the trade is open in front of you and the chart is blank. Making the
 * fix one tap away at that moment is the difference between reviewing tonight
 * and reviewing never.
 */
export function GetCandles({ symbol, from, to, hasKey }: {
  symbol: string; from: string; to: string; hasKey: boolean;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const router = useRouter();

  if (!hasKey) return null;

  async function go() {
    setState("working");
    try {
      const r = await fetch("/api/candles/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, from, to }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMessage([j.error, j.detail, j.hint].filter(Boolean).join(" "));
        setState("error");
        return;
      }
      setState("idle");
      router.refresh();
    } catch {
      setMessage("Could not reach the server. Try again in a moment.");
      setState("error");
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={go} disabled={state === "working"}
        className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
        style={{ background: "var(--ink)", color: "var(--plane)", opacity: state === "working" ? 0.6 : 1 }}>
        {state === "working" ? "Fetching…" : "Get the candles for this day"}
      </button>
      {state === "error" && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--loss)" }}>{message}</p>
      )}
    </div>
  );
}
