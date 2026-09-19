"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseExnessCsv, type ParseResult } from "@/lib/core/parse-exness";
import { clusterPositions } from "@/lib/core/cluster";
import { computeStats } from "@/lib/core/metrics";

type Stage = { kind: "idle" } | { kind: "parsed"; res: ParseResult; filename: string }
  | { kind: "saving" } | { kind: "error"; message: string }
  | { kind: "done"; inserted: number; duplicates: number; zoneTrades: number };

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

export default function ImportClient() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const router = useRouter();

  async function onFile(file: File) {
    try {
      // Parsed in the browser: a big export never has to fit in a request body.
      const res = parseExnessCsv(await file.text());
      setStage({ kind: "parsed", res, filename: file.name });
    } catch (e) {
      setStage({ kind: "error", message: e instanceof Error ? e.message : "Could not read that file" });
    }
  }

  async function commit(res: ParseResult, filename: string) {
    setStage({ kind: "saving" });
    try {
      const r = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          reportedNet: res.summary.net,
          positions: res.positions.map((p) => ({
            ...p, openedAt: p.openedAt.toISOString(), closedAt: p.closedAt.toISOString(),
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      setStage({ kind: "done", inserted: j.inserted, duplicates: j.duplicates, zoneTrades: j.zoneTrades });
      router.refresh();
    } catch (e) {
      setStage({ kind: "error", message: e instanceof Error ? e.message : "Import failed" });
    }
  }

  if (stage.kind === "parsed") {
    const { summary, positions, skipped } = stage.res;
    const zones = clusterPositions(positions);
    const s = computeStats(zones);
    return (
      <div className="space-y-4">
        {/* Reconciliation first. Nothing is saved until the numbers are shown and
            accepted — a silent import that disagrees with the broker is fatal. */}
        <div className="card p-5">
          <div className="eyebrow">Check this against your statement</div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Rows parsed" value={`${summary.parsed} / ${summary.rows}`} />
            <Fact label="Net P&L" value={money(summary.net)} tone={summary.net >= 0 ? "pos" : "neg"} />
            <Fact label="Zone trades" value={`${zones.length}`} />
            <Fact label="Date range" value={
              summary.from && summary.to
                ? `${summary.from.toISOString().slice(0, 10)} → ${summary.to.toISOString().slice(0, 10)}`
                : "—"} />
          </div>
          <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--ink2)" }}>
            If that net does not match your broker to the cent, do not import — tell me
            and the parser gets fixed. {summary.withStop} of {summary.parsed} trades had a
            platform stop, {summary.withTarget} had a target.
          </p>
        </div>

        <div className="card p-5">
          <div className="eyebrow">What the data already says</div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Win rate" value={`${(s.winRate * 100).toFixed(1)}%`} />
            <Fact label="Break-even needed" value={s.breakEvenWinRate ? `${(s.breakEvenWinRate * 100).toFixed(1)}%` : "—"} />
            <Fact label="Edge" value={s.edgePoints !== null ? `${s.edgePoints > 0 ? "+" : ""}${s.edgePoints.toFixed(2)} pts` : "—"}
                  tone={(s.edgePoints ?? 0) > 0 ? "pos" : "neg"} />
            <Fact label="Profit factor" value={s.profitFactor?.toFixed(3) ?? "—"} />
          </div>
        </div>

        {skipped.length > 0 && (
          <div className="card p-4 text-xs" style={{ color: "var(--ink2)" }}>
            <b>{skipped.length} rows skipped</b> — {[...new Set(skipped.map((x) => x.reason))].join(", ")}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => commit(stage.res, stage.filename)}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: "var(--ink)", color: "var(--plane)" }}>
            Import {summary.parsed} trades
          </button>
          <button onClick={() => setStage({ kind: "idle" })}
            className="rounded-lg px-4 py-2.5 text-sm" style={{ color: "var(--ink2)" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "saving") return <div className="card p-6 text-sm">Importing…</div>;

  if (stage.kind === "done") {
    return (
      <div className="card space-y-3 p-6">
        <div className="text-sm">
          Imported <b>{stage.inserted}</b> new positions
          {stage.duplicates > 0 && <> · {stage.duplicates} already had</>} ·{" "}
          <b>{stage.zoneTrades}</b> zone trades after clustering.
        </div>
        <div className="flex gap-3">
          <a href="/dashboard" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
             style={{ background: "var(--ink)", color: "var(--plane)" }}>
            See the dashboard
          </a>
          <button onClick={() => setStage({ kind: "idle" })}
            className="rounded-lg px-4 py-2.5 text-sm" style={{ color: "var(--ink2)" }}>
            Import another chunk
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stage.kind === "error" && (
        <div className="card p-4 text-sm" style={{ borderColor: "var(--loss)", color: "var(--loss)" }}>
          {stage.message}
        </div>
      )}
      <label
        className="card flex cursor-pointer flex-col items-center justify-center gap-2 p-12 text-center"
        style={{ borderStyle: "dashed" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      >
        <span className="text-sm font-semibold">Drop your CSV here</span>
        <span className="text-xs" style={{ color: "var(--ink3)" }}>or tap to choose a file</span>
        <input type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
      <p className="text-xs" style={{ color: "var(--ink3)" }}>
        Nothing is saved until you have seen the numbers and confirmed them.
      </p>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div>
      <div className="num text-lg font-semibold tracking-tight"
           style={{ color: tone === "pos" ? "var(--profit)" : tone === "neg" ? "var(--loss)" : undefined }}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink3)" }}>{label}</div>
    </div>
  );
}
