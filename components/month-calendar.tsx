import Link from "next/link";

export interface DayCell { date: string; net: number; trades: number }

/** YYYY-MM keys present in the data, newest first. */
export function monthsIn(days: DayCell[]): string[] {
  return [...new Set(days.map((d) => d.date.slice(0, 7)))].sort().reverse();
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

/**
 * One month at a time, with the month named and arrows to step through it.
 *
 * Showing every month at once was unreadable and, worse, left the reader with no
 * idea which squares belonged to which month. A calendar's job is orientation.
 */
export function MonthCalendar({ days, month, months, base, scale }: {
  days: DayCell[];
  month: string;
  months: string[];
  base: string;
  /** Colour scale across the whole history, so months stay comparable. */
  scale: number;
}) {
  const inMonth = days.filter((d) => d.date.startsWith(month));
  const byDate = new Map(inMonth.map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number);

  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first

  const idx = months.indexOf(month);
  const prev = idx < months.length - 1 ? months[idx + 1] : null;
  const next = idx > 0 ? months[idx - 1] : null;

  const net = inMonth.reduce((s, d) => s + d.net, 0);
  const up = inMonth.filter((d) => d.net > 0).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Link href={prev ? `${base}?month=${prev}` : "#"} aria-disabled={!prev} scroll={false}
              className="grid h-8 w-8 place-items-center rounded-lg text-[15px]"
              style={{ border: "1px solid var(--line)", color: prev ? "var(--ink2)" : "var(--line)",
                       pointerEvents: prev ? "auto" : "none" }}>‹</Link>
        <div className="text-center">
          <div className="text-[14px] font-semibold">{monthLabel(month)}</div>
          <div className="num text-[11px]" style={{ color: "var(--ink3)" }}>
            {inMonth.length ? `${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(0)} · ${up}/${inMonth.length} days up` : "no trades"}
          </div>
        </div>
        <Link href={next ? `${base}?month=${next}` : "#"} aria-disabled={!next} scroll={false}
              className="grid h-8 w-8 place-items-center rounded-lg text-[15px]"
              style={{ border: "1px solid var(--line)", color: next ? "var(--ink2)" : "var(--line)",
                       pointerEvents: next ? "auto" : "none" }}>›</Link>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[9.5px] font-semibold" style={{ color: "var(--ink3)" }}>{d}</div>
        ))}
        {Array.from({ length: lead }).map((_, i) => <div key={`p${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1;
          const key = `${month}-${String(dayNum).padStart(2, "0")}`;
          const d = byDate.get(key);
          const bg = !d || d.net === 0
            ? "var(--s1)"
            : `color-mix(in srgb, var(${d.net > 0 ? "--profit" : "--loss"}) ${Math.round(16 + Math.min(1, Math.abs(d.net) / scale) * 54)}%, var(--s1))`;

          const inner = (
            <>
              <span className="num text-[9px] leading-none" style={{ color: "var(--ink3)" }}>{dayNum}</span>
              {d && (
                <span className={`num text-[10px] font-bold leading-tight ${d.net > 0 ? "pos" : d.net < 0 ? "neg" : ""}`}>
                  {Math.abs(d.net) < 0.5 ? "0" : `${d.net > 0 ? "+" : "−"}${Math.abs(d.net).toFixed(0)}`}
                </span>
              )}
            </>
          );
          const cls = "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg p-0.5";
          const style = { background: bg, border: `1px solid ${d ? "var(--line)" : "transparent"}` };

          return d ? (
            <Link key={key} href={`/trades?date=${key}`} className={cls} style={style}
                  title={`${d.trades} trades`}>{inner}</Link>
          ) : (
            <div key={key} className={cls} style={style}>{inner}</div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px]" style={{ color: "var(--ink3)" }}>
        Tap a day to see its trades
      </p>
    </div>
  );
}

/** Week-on-week or month-on-month, each row against the one before it. */
export function PeriodTrend({ rows, label }: {
  rows: { key: string; label: string; net: number; trades: number; winRate: number }[];
  label: string;
}) {
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 0.0001);
  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((r, i) => {
        const prev = rows[i + 1];
        const delta = prev ? r.net - prev.net : null;
        return (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-[76px] shrink-0 text-[12.5px] font-medium sm:w-[96px]">{r.label}</div>
            <div className="relative h-4 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--ink3)", opacity: 0.4 }} />
              <span className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]"
                    style={{
                      width: `${(Math.abs(r.net) / max) * 50}%`,
                      background: r.net >= 0 ? "var(--profit)" : "var(--loss)",
                      ...(r.net >= 0 ? { left: "50%" } : { right: "50%" }),
                    }} />
            </div>
            <div className="w-[62px] shrink-0 text-right">
              <div className={`num text-[12.5px] font-bold ${r.net >= 0 ? "pos" : "neg"}`}>
                {r.net >= 0 ? "+" : "−"}${Math.abs(r.net).toFixed(0)}
              </div>
              {delta !== null && (
                <div className="num text-[10px]" style={{ color: "var(--ink3)" }}>
                  {delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-[11px]" style={{ color: "var(--ink3)" }}>
        Each {label} against the one before it
      </p>
    </div>
  );
}
