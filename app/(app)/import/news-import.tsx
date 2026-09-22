"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseCalendarCsv, type NewsEvent } from "@/lib/core/news";
import { COMMON_ZONES } from "@/lib/timezones";

/**
 * Economic releases, from a rule or from a file.
 *
 * Gold is the instrument this matters most for: a dollar release moves it
 * several dollars in seconds and widens the spread to many times its normal
 * width, so a level that has held all week stops meaning anything for twenty
 * minutes. The journal already has a "news" tag, and it is self-reported —
 * which is to say remembered, which is to say least reliable about exactly the
 * trades worth knowing.
 */
export function NewsImport({ coverage }: {
  coverage: { events: number; high: number; from: string | null; to: string | null };
}) {
  const [zone, setZone] = useState("America/New_York");
  const [preview, setPreview] = useState<{ events: NewsEvent[]; skipped: number; rows: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function read(file: File) {
    setMessage(null);
    const text = await file.text();
    const r = parseCalendarCsv(text, zone);
    if (!r.events.length) {
      setPreview(null);
      setMessage(
        r.rows === 0
          ? "That file had no rows in it."
          : "None of those rows could be read. The file needs a header row with at least a title and a date.",
      );
      return;
    }
    setPreview(r);
  }

  async function store(events: NewsEvent[]) {
    setBusy(true);
    try {
      const r = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "import",
          events: events.map((e) => ({
            at: e.at.toISOString(), currency: e.currency, title: e.title, impact: e.impact,
          })),
        }),
      });
      const j = await r.json();
      setMessage(r.ok
        ? `Stored ${j.stored}${j.duplicates ? `, and skipped ${j.duplicates} already held` : ""}.`
        : (j.error ?? "That did not work."));
      if (r.ok) { setPreview(null); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }

  async function derive() {
    setBusy(true);
    try {
      const nowYear = new Date().getUTCFullYear();
      const r = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "derive", fromYear: nowYear - 5, toYear: nowYear + 1 }),
      });
      const j = await r.json();
      setMessage(r.ok ? `Stored ${j.stored} payroll releases.` : (j.error ?? "That did not work."));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="eyebrow">Already held</div>
        <p className="mt-2 text-[15px]">
          {coverage.events === 0
            ? "No economic releases yet, so nothing is being flagged as a news trade."
            : `${coverage.events.toLocaleString("en-US")} releases, ${coverage.high.toLocaleString("en-US")} of them high impact, from ${coverage.from} to ${coverage.to}.`}
        </p>
      </div>

      <div className="card p-5">
        <div className="eyebrow">Non-farm payrolls, worked out</div>
        <p className="mt-2 text-[15px]">
          One release has a timing that is a rule rather than a calendar entry: the first Friday
          of the month, half past eight in New York. That one can be filled in for years of
          history without importing anything.
        </p>
        <button type="button" onClick={derive} disabled={busy}
          className="mt-3 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
          style={{ background: "var(--ink)", color: "var(--plane)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : "Fill in payrolls, last five years"}
        </button>
        <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
          Half past eight in New York, not half past one UTC — the gap between those is an hour
          for four months of the year, and an hour is two of these windows.
        </p>
      </div>

      <div className="card p-5">
        <div className="eyebrow">A calendar file</div>
        <p className="mt-2 text-[15px]">
          Everything else needs a calendar. Most sites let you export one as CSV; any file with
          a title, a date and a time will do.
        </p>

        <label className="mt-4 block text-[13px] font-semibold">What time zone are its times in?</label>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>
          Calendar sites write times in whatever zone the site was set to. An import an hour out
          is worse than no import, because it still looks like an answer.
        </p>
        <select value={zone} onChange={(e) => setZone(e.target.value)}
                className="mt-2 w-full rounded-lg px-3 py-2.5 text-[13px]"
                style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}>
          <option value="America/New_York">US Eastern — New York (the usual default)</option>
          {COMMON_ZONES.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
        </select>

        <input type="file" accept=".csv,text/csv,text/plain"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }}
               className="mt-3 block w-full text-[13px]" />

        {preview && (
          <div className="mt-3 rounded-lg p-3" style={{ background: "var(--s3)" }}>
            <p className="text-[13px]">
              <b>{preview.events.length.toLocaleString("en-US")} releases</b> read from{" "}
              {preview.rows.toLocaleString("en-US")} rows
              {preview.skipped ? `, ${preview.skipped} skipped (all-day or unreadable)` : ""}.
            </p>
            <p className="num mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              {preview.events[0].at.toISOString().slice(0, 16).replace("T", " ")} →{" "}
              {preview.events[preview.events.length - 1].at.toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
            <ul className="mt-2 space-y-0.5 text-[11.5px]" style={{ color: "var(--ink2)" }}>
              {preview.events.slice(0, 3).map((e, i) => (
                <li key={i} className="truncate">
                  <span className="num">{e.at.toISOString().slice(0, 16).replace("T", " ")}</span>{" "}
                  · {e.currency} · {e.impact} · {e.title}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              Check one of those against the source before storing. If they are an hour out, the
              zone above is wrong.
            </p>
            <button type="button" onClick={() => store(preview.events)} disabled={busy}
              className="mt-3 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
              style={{ background: "var(--ink)", color: "var(--plane)", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Storing…" : `Store ${preview.events.length.toLocaleString("en-US")} releases`}
            </button>
          </div>
        )}

        {message && <p className="mt-3 text-[13px]" style={{ color: "var(--ink2)" }}>{message}</p>}
      </div>
    </div>
  );
}
