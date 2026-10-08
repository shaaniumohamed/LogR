/**
 * Which days are held, month by month.
 *
 * One row per month and one square per day, so a missing day stands out as a
 * hole in a row rather than a number in a list. Weekends are expected to be
 * empty. A weekday without data is one of two things, drawn differently: a
 * market holiday (Good Friday, Christmas, New Year — expected, dashed grey),
 * or a day missing from the files (red), which is the only kind worth chasing.
 */
import { Info } from "@/components/info";
import { marketHoliday } from "@/lib/core/market/calendar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Coverage({ days }: { days: { day: string; ticks: number }[] }) {
  if (!days.length) return null;
  const held = new Map(days.map((d) => [d.day, d.ticks]));
  const sorted = [...days].map((d) => d.ticks).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] || 1;

  const first = new Date(`${days[0].day}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1].day}T00:00:00Z`);
  const months: { y: number; m: number }[] = [];
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) {
    months.push({ y, m });
  }
  const years = [...new Set(months.map((x) => x.y))].reverse();

  return (
    <div className="mt-3 space-y-2">
      {years.map((y, i) => {
        const yearDays = days.filter((d) => d.day.startsWith(String(y)));
        const empty = months.filter((x) => x.y === y).flatMap(({ m }) => {
          const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          return Array.from({ length: n }, (_, k) => new Date(Date.UTC(y, m, k + 1)))
            .filter((d) => d >= first && d <= last)
            .filter((d) => { const wd = d.getUTCDay(); return wd !== 0 && wd !== 6; })
            .map((d) => d.toISOString().slice(0, 10))
            .filter((key) => !held.has(key));
        });
        const gaps = empty.filter((key) => !marketHoliday(key));
        const holidays = empty.filter((key) => marketHoliday(key));
        return (
          <details key={y} open={i === 0} className="rounded-lg" style={{ border: "1px solid var(--line)" }}>
            <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.5px]">
              <b className="num">{y}</b>
              <span style={{ color: "var(--ink3)" }}>{yearDays.length} days</span>
              {gaps.length > 0
                ? <span className="chip chip-warn ml-auto">{gaps.length} weekday{gaps.length === 1 ? "" : "s"} missing</span>
                : <span className="chip chip-profit ml-auto">complete</span>}
            </summary>
            <div className="space-y-1 overflow-x-auto px-3 pb-3">
              {months.filter((x) => x.y === y).map(({ m }) => {
                const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
                return (
                  <div key={m} className="flex items-center gap-2">
                    <span className="w-7 shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{MONTHS[m]}</span>
                    <div className="flex gap-[2px]">
                      {Array.from({ length: n }, (_, k) => {
                        const d = new Date(Date.UTC(y, m, k + 1));
                        const key = d.toISOString().slice(0, 10);
                        const ticks = held.get(key);
                        const wd = d.getUTCDay();
                        const weekend = wd === 0 || wd === 6;
                        const inRange = d >= first && d <= last;
                        const holiday = !ticks && !weekend ? marketHoliday(key) : null;
                        const missing = inRange && !ticks && !weekend && !holiday;
                        const strength = ticks ? Math.min(1, 0.35 + 0.65 * (ticks / typical)) : 0;
                        return (
                          <span key={k}
                                title={`${key}: ${ticks ? `${ticks.toLocaleString("en-US")} ticks` : weekend ? "weekend" : holiday ? `${holiday} — market closed` : "no data in the files"}`}
                                className="block h-[9px] w-[9px] rounded-[2px]"
                                style={ticks
                                  ? { background: `color-mix(in srgb, var(--profit) ${Math.round(strength * 100)}%, var(--s3))` }
                                  : missing
                                    ? { boxShadow: "inset 0 0 0 1.5px var(--loss)" }
                                    : holiday && inRange
                                      ? { outline: "1px dashed var(--ink3)", outlineOffset: "-1px" }
                                      : { background: weekend ? "transparent" : "var(--s3)", opacity: inRange ? 1 : 0.4 }} />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {gaps.length > 0 && gaps.length <= 12 && (
                <p className="pt-1 text-[11.5px]" style={{ color: "var(--loss)" }}>
                  Missing from the files: {gaps.map((key) => key.slice(5)).join(", ")}
                </p>
              )}
              {holidays.length > 0 && (
                <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  Market closed: {holidays.map((key) => `${key.slice(5)} ${marketHoliday(key)}`).join(", ")}
                </p>
              )}
            </div>
          </details>
        );
      })}
      <Info title="Red days and dashed days">
        A <b>dashed</b> day is a market holiday — Good Friday, Christmas or New Year, or the
        weekday one of them moved to. Gold is shut, so there is nothing to find.
        <br /><br />
        A <b>red</b> day was a normal trading day with no ticks in the files. The import report
        says whether the file itself had none (open the year again and import the same file: it
        re-reads it and uploads nothing that is already held). If Exness offers that month as a
        separate download, importing it fills only the missing days. If not, leave it: a handful
        of days in eleven years does not change a backtest, and the replay treats a missing day
        like a closed market. Prices from another broker would not match Exness&rsquo;s, so they
        are better left out.
      </Info>
    </div>
  );
}

