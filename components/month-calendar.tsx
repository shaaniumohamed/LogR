import Link from "next/link";
import { monthLabel, stepMonth, weeksOfMonth } from "@/lib/core/calendar";

export interface DayCell { date: string; net: number; trades: number }

export { monthLabel };

/** Months present in the data, newest first. Kept for callers that list them. */
export function monthsIn(days: DayCell[]): string[] {
  return [...new Set(days.map((d) => d.date.slice(0, 7)))].sort().reverse();
}

const short = (n: number) =>
  Math.abs(n) >= 1000 ? `${n > 0 ? "" : "−"}${(Math.abs(n) / 1000).toFixed(1)}k` : String(Math.round(Math.abs(n)));

/**
 * One month, named, with a total beside every week.
 *
 * Three things a calendar has to do and this one previously only did in part.
 * It has to say which month you are looking at. Its arrows have to keep working
 * — they used to step only between months that contained trades, so a month off
 * ended the journey and the calendar felt broken. And a square has to lead
 * somewhere: tapping a day opens that day, because the reason anyone taps a red
 * square is to find out what happened.
 *
 * Week totals are down the right because a month's result is almost always one
 * week's doing, and thirty separate squares cannot show that.
 */
export function MonthCalendar({ days, month, first, last, base, scale, today }: {
  days: DayCell[];
  month: string;
  /** Oldest and newest month the arrows may reach. */
  first: string;
  last: string;
  base: string;
  /** Colour scale across the whole history, so months stay comparable. */
  scale: number;
  /** Today in the trader's zone, so the current day can be ringed. */
  today?: string;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = weeksOfMonth(month);

  const prev = month > first ? stepMonth(month, -1) : null;
  const next = month < last ? stepMonth(month, 1) : null;

  const inMonth = days.filter((d) => d.date.startsWith(month));
  const net = inMonth.reduce((s, d) => s + d.net, 0);
  const up = inMonth.filter((d) => d.net > 0).length;

  const arrow = (to: string | null, glyph: string, label: string) => (
    <Link href={to ? `${base}?month=${to}` : "#"} aria-disabled={!to} aria-label={label} scroll={false}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px]"
          style={{ border: "1px solid var(--line)", color: to ? "var(--ink2)" : "var(--line)",
                   pointerEvents: to ? "auto" : "none" }}>{glyph}</Link>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {arrow(prev, "‹", "Previous month")}
        <div className="min-w-0 text-center">
          <div className="truncate text-[15px] font-semibold">{monthLabel(month)}</div>
          <div className="num text-[11px]" style={{ color: "var(--ink3)" }}>
            {inMonth.length
              ? `${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(0)} · ${up}/${inMonth.length} days up`
              : "no trades this month"}
          </div>
        </div>
        {arrow(next, "›", "Next month")}
      </div>

      <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr)) 40px" }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[9.5px] font-semibold" style={{ color: "var(--ink3)" }}>{d}</div>
        ))}
        <div className="pb-1 text-center text-[9.5px] font-semibold" style={{ color: "var(--ink3)" }}>wk</div>

        {weeks.map((w) => {
          const cells = w.days.map((key) => (key ? byDate.get(key) ?? null : null));
          const weekNet = cells.reduce((s, c) => s + (c?.net ?? 0), 0);
          const weekTrades = cells.reduce((s, c) => s + (c?.trades ?? 0), 0);

          return (
            <div key={w.key} className="contents">
              {w.days.map((key, i) => {
                const d = key ? cells[i] : null;
                if (!key) return <div key={`pad-${w.key}-${i}`} />;

                const bg = !d || d.net === 0
                  ? "var(--s1)"
                  : `color-mix(in srgb, var(${d.net > 0 ? "--profit" : "--loss"}) ${Math.round(16 + Math.min(1, Math.abs(d.net) / scale) * 54)}%, var(--s1))`;
                const isToday = key === today;

                const inner = (
                  <>
                    <span className="num text-[9px] leading-none"
                          style={{ color: isToday ? "var(--ink)" : "var(--ink3)", fontWeight: isToday ? 700 : 400 }}>
                      {Number(key.slice(8))}
                    </span>
                    {d && (
                      <>
                        <span className={`num text-[10.5px] font-bold leading-tight ${d.net > 0 ? "pos" : d.net < 0 ? "neg" : ""}`}>
                          {Math.abs(d.net) < 0.5 ? "0" : `${d.net > 0 ? "+" : "−"}${short(d.net)}`}
                        </span>
                        <span className="num text-[8px] leading-none" style={{ color: "var(--ink3)" }}>
                          {d.trades}
                        </span>
                      </>
                    )}
                  </>
                );
                const cls = "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg p-0.5";
                const style = {
                  background: bg,
                  border: isToday ? "1.5px solid var(--ink)" : `1px solid ${d ? "var(--line)" : "transparent"}`,
                };

                return d ? (
                  <Link key={key} href={`/day/${key}`} className={cls} style={style}
                        title={`${d.trades} ${d.trades === 1 ? "trade" : "trades"}`}>{inner}</Link>
                ) : (
                  <div key={key} className={cls} style={style}>{inner}</div>
                );
              })}

              <div className="flex aspect-square flex-col items-center justify-center rounded-lg"
                   style={{ background: "var(--s3)" }}>
                {weekTrades > 0 ? (
                  <>
                    <span className={`num text-[10px] font-bold leading-tight ${weekNet > 0 ? "pos" : weekNet < 0 ? "neg" : ""}`}>
                      {weekNet > 0 ? "+" : weekNet < 0 ? "−" : ""}{short(weekNet)}
                    </span>
                    <span className="num text-[8px] leading-none" style={{ color: "var(--ink3)" }}>{weekTrades}</span>
                  </>
                ) : (
                  <span className="text-[9px]" style={{ color: "var(--ink3)" }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[11px]" style={{ color: "var(--ink3)" }}>
        Tap a day to open it · the right-hand column is that week&rsquo;s total
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
