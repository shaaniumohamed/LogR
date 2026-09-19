"use client";

import { useEffect, useState } from "react";
import { setTimeZone } from "@/lib/actions";

/**
 * Keeps the app's clock pointed at wherever the trader actually is.
 *
 * Two behaviours on purpose. If no zone has been chosen yet, adopt the browser's
 * silently — the alternative is showing UTC and quietly mislabelling every
 * time-of-day finding. If one HAS been chosen and the trader has since moved,
 * ask rather than switch: changing zones re-buckets every past trade, and doing
 * that underneath someone mid-read would be disorienting.
 */
export function ZoneSync({ saved }: { saved: string }) {
  const [detected, setDetected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let tz: string | null = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return; }
    if (!tz || tz === saved) return;
    if (saved === "UTC") { void setTimeZone(tz); return; }
    setDetected(tz);
  }, [saved]);

  if (!detected || dismissed) return null;

  const city = detected.split("/").pop()?.replace(/_/g, " ") ?? detected;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl p-3 text-[12.5px]"
         style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
      <span style={{ color: "var(--ink2)" }}>
        You seem to be in <b>{city}</b> now, but times are showing in{" "}
        <b>{saved.split("/").pop()?.replace(/_/g, " ")}</b> time.
      </span>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); await setTimeZone(detected); location.reload(); }}
        className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
        style={{ background: "var(--ink)", color: "var(--plane)" }}
      >
        {busy ? "Switching…" : `Switch to ${city}`}
      </button>
      <button onClick={() => setDismissed(true)} style={{ color: "var(--ink3)" }}>Keep current</button>
    </div>
  );
}
