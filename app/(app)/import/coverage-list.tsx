"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface CoverageRow { symbol: string; bars: number; from: string; to: string }

/**
 * What price history exists, with a way to remove it.
 *
 * Removal matters because the bar table is shared and keyed on (symbol, time):
 * re-importing corrected data overwrites bars at the same timestamps, but bars
 * filed under the wrong instrument are not at those timestamps and would sit
 * there forever. This is the undo for that.
 */
export function CoverageList({ rows }: { rows: CoverageRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function clear(symbol: string, bars: number) {
    const ok = window.confirm(
      `Remove all ${bars.toLocaleString("en-US")} ${symbol} candles?\n\n` +
      `Price history is shared, so this removes them for everyone using this journal. ` +
      `Your trades are not touched.`,
    );
    if (!ok) return;
    setBusy(symbol);
    try {
      await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="mt-3 space-y-1.5 text-[13px]">
      {rows.map((c) => (
        <li key={c.symbol} className="flex flex-wrap items-baseline gap-x-2">
          <b className="num">{c.symbol}</b>
          <span className="num" style={{ color: "var(--ink2)" }}>{c.bars.toLocaleString("en-US")} candles</span>
          <span style={{ color: "var(--ink3)" }}>{c.from} → {c.to}</span>
          <button type="button" onClick={() => clear(c.symbol, c.bars)} disabled={busy === c.symbol}
                  className="tap ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>
            {busy === c.symbol ? "Removing…" : "Remove"}
          </button>
        </li>
      ))}
    </ul>
  );
}
