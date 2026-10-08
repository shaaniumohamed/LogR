"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Eyebrow, Note } from "@/components/ui";

/**
 * Removing a bad year, or everything for a symbol. Two taps each — the second
 * one names what will go — because the data is shared and a slip here is
 * everyone's missing history until it is imported again.
 */
export function RemoveData({ symbol, years }: { symbol: string; years: string[] }) {
  const router = useRouter();
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function remove(year: string | null) {
    const id = year ?? "all";
    if (armed !== id) { setArmed(id); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/market/delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(year ? { symbol, year } : { symbol }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMsg(`Removed ${body.removed} files.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not remove it.");
    } finally {
      setBusy(false);
      setArmed(null);
    }
  }

  return (
    <Card>
      <Eyebrow>Remove price history</Eyebrow>
      <Note>For a bad import. A year is removed whole — its ticks and every candle built from them — and can be imported again.</Note>
      <div className="mt-3 flex flex-wrap gap-2">
        {years.map((y) => (
          <button key={y} type="button" disabled={busy} onClick={() => remove(y)}
                  className={armed === y ? "btn btn-danger" : "btn btn-secondary"}>
            {armed === y ? `Remove ${y}?` : y}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => remove(null)}
                className={armed === "all" ? "btn btn-danger" : "btn btn-ghost"}>
          {armed === "all" ? `Remove all ${symbol}?` : `Remove all ${symbol}`}
        </button>
      </div>
      {msg && <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>{msg}</p>}
    </Card>
  );
}
