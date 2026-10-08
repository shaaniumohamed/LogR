"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Eyebrow, Note } from "@/components/ui";
import type { ImportProgress, ImportReport } from "@/lib/market/importer";
import type { WorkerIn, WorkerOut } from "@/lib/market/import.worker";

const nf = new Intl.NumberFormat("en-US");
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

interface FileState {
  name: string;
  size: number;
  status: "waiting" | "running" | "done" | "failed" | "cancelled";
  progress?: ImportProgress;
  report?: ImportReport;
  error?: string;
  startedAt?: number;
}

/**
 * Pick the Exness tick files, watch them go in.
 *
 * The work happens in a Web Worker so this page stays usable; the screen is
 * asked to stay awake, because a laptop that sleeps halfway through a year of
 * ticks stops the import (running it again carries on where it stopped).
 */
export function Importer() {
  const router = useRouter();
  const [files, setFiles] = useState<FileState[]>([]);
  const [running, setRunning] = useState(false);
  const chosen = useRef<File[]>([]);
  const worker = useRef<Worker | null>(null);
  const wake = useRef<{ release(): Promise<void> } | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  // Leaving mid-import loses the rest of it; ask first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function choose(list: FileList | null) {
    const picked = Array.from(list ?? []).sort((a, b) => a.name.localeCompare(b.name));
    chosen.current = picked;
    setFiles(picked.map((f) => ({ name: f.name, size: f.size, status: "waiting" })));
  }

  async function start() {
    if (!chosen.current.length || running) return;
    setRunning(true);
    try {
      wake.current = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } })
        .wakeLock?.request("screen") ?? null;
    } catch { /* not supported or refused: the import still runs */ }

    const w = new Worker(new URL("../../../../lib/market/import.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const update = (i: number, patch: Partial<FileState>) =>
      setFiles((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));
    const finish = () => {
      setRunning(false);
      void wake.current?.release().catch(() => undefined);
      wake.current = null;
      w.terminate();
      worker.current = null;
      router.refresh();
    };
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") {
        setFiles((fs) => fs.map((f, k) => (k === m.index ? { ...f, status: "running", progress: m.progress, startedAt: f.startedAt ?? Date.now() } : f)));
      }
      else if (m.type === "fileDone") update(m.index, { status: "done", report: m.report, progress: m.report });
      else if (m.type === "error") { update(m.index, { status: m.cancelled ? "cancelled" : "failed", error: m.message }); finish(); }
      else if (m.type === "done") finish();
    };
    w.onerror = (e) => { setFiles((fs) => fs.map((f) => (f.status === "running" || f.status === "waiting" ? { ...f, status: "failed", error: e.message || "The import stopped unexpectedly." } : f))); finish(); };
    w.postMessage({ type: "start", files: chosen.current } satisfies WorkerIn);
  }

  function cancel() {
    worker.current?.postMessage({ type: "cancel" } satisfies WorkerIn);
  }

  return (
    <Card>
      <Eyebrow>Import tick files</Eyebrow>
      <Note>
        Choose one or more Exness tick history files — the .zip downloads as they are, or an
        unzipped .csv. A year takes a few minutes; keep this page open until it finishes.
      </Note>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="btn btn-secondary cursor-pointer" aria-disabled={running}>
          Choose files
          <input type="file" accept=".zip,.csv,.txt" multiple className="sr-only" disabled={running}
                 onChange={(e) => choose(e.target.files)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={!files.length || running} onClick={start}>
          {running ? "Importing…" : files.length > 1 ? `Import ${files.length} files` : "Import"}
        </button>
        {running && <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>}
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-3" aria-live="polite">
          {files.map((f) => <FileRow key={f.name} f={f} />)}
        </ul>
      )}
    </Card>
  );
}

function FileRow({ f }: { f: FileState }) {
  const p = f.progress;
  const frac = p && p.totalBytes ? Math.min(1, p.bytesRead / p.totalBytes) : f.status === "done" ? 1 : 0;
  const elapsed = f.startedAt ? (Date.now() - f.startedAt) / 1000 : 0;
  const eta = frac > 0.02 && f.status === "running" ? Math.round((elapsed / frac) * (1 - frac)) : null;
  const tone = f.status === "failed" ? "var(--loss)" : f.status === "done" ? "var(--profit)" : "var(--c1)";
  const r = f.report;
  const warnings = r ? r.parse.malformed + r.parse.badPrice + r.parse.otherSymbol + r.late : 0;

  return (
    <li className="rounded-lg p-3" style={{ background: "var(--s2)", border: "1px solid var(--line)" }}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{f.name}</span>
        <span className="num shrink-0 text-[12px]" style={{ color: "var(--ink3)" }}>{mb(f.size)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
        <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(2, frac * 100)}%`, background: tone }} />
      </div>
      <div className="num mt-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
        {f.status === "waiting" && "Waiting"}
        {f.status === "running" && p && (
          <>
            {p.phase === "finishing" ? "Finishing — building candles" : `${Math.round(frac * 100)}%`}
            {p.currentDay && <> · up to {p.currentDay}</>}
            {" · "}{nf.format(p.ticks)} ticks · {p.uploaded} uploaded{p.skipped ? `, ${p.skipped} already held` : ""}
            {eta !== null && eta > 5 && <> · about {eta > 90 ? `${Math.round(eta / 60)} min` : `${eta} s`} left</>}
          </>
        )}
        {f.status === "done" && r && (
          <span style={{ color: "var(--profit)" }}>
            Done: {r.symbol} {r.firstDay} → {r.lastDay}, {r.days} days, {nf.format(r.ticks)} ticks
            {" · "}{r.uploaded} files uploaded{r.skipped ? `, ${r.skipped} unchanged` : ""}
          </span>
        )}
        {(f.status === "failed" || f.status === "cancelled") && (
          <span style={{ color: f.status === "failed" ? "var(--loss)" : "var(--ink3)" }}>
            {f.error} {f.status === "failed" && "Run the import again to carry on from where it stopped."}
          </span>
        )}
      </div>
      {r && warnings > 0 && (
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--warn)" }}>
          Skipped {nf.format(warnings)} line{warnings === 1 ? "" : "s"}:
          {r.parse.malformed ? ` ${nf.format(r.parse.malformed)} unreadable` : ""}
          {r.parse.badPrice ? ` ${nf.format(r.parse.badPrice)} with ask below bid` : ""}
          {r.parse.otherSymbol ? ` ${nf.format(r.parse.otherSymbol)} for another symbol` : ""}
          {r.late ? ` ${nf.format(r.late)} out of order across days` : ""}.
        </p>
      )}
    </li>
  );
}
