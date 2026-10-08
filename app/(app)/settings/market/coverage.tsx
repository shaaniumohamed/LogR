/**
 * Which days are held, month by month.
 *
 * One row per month and one square per day, so a missing day stands out as a
 * hole in a row rather than a number in a list. Weekends are expected to be
 * empty; a weekday without data is outlined, because that is the thing an
 * import might have got wrong. 25 December and 1 January are not flagged —
 * gold does not trade then.
 */
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
        const gaps = months.filter((x) => x.y === y).flatMap(({ m }) => {
          const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          return Array.from({ length: n }, (_, k) => new Date(Date.UTC(y, m, k + 1)))
            .filter((d) => d >= first && d <= last)
            .filter((d) => { const wd = d.getUTCDay(); return wd !== 0 && wd !== 6; })
            .filter((d) => !isHoliday(d))
            .filter((d) => !held.has(d.toISOString().slice(0, 10)));
        });
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
                        const missing = inRange && !ticks && !weekend && !isHoliday(d);
                        const strength = ticks ? Math.min(1, 0.35 + 0.65 * (ticks / typical)) : 0;
                        return (
                          <span key={k} title={`${key}: ${ticks ? `${ticks.toLocaleString("en-US")} ticks` : weekend ? "weekend" : "no data"}`}
                                className="block h-[9px] w-[9px] rounded-[2px]"
                                style={ticks
                                  ? { background: `color-mix(in srgb, var(--profit) ${Math.round(strength * 100)}%, var(--s3))` }
                                  : missing
                                    ? { boxShadow: "inset 0 0 0 1.5px var(--loss)" }
                                    : { background: weekend ? "transparent" : "var(--s3)", opacity: inRange ? 1 : 0.4 }} />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {gaps.length > 0 && gaps.length <= 12 && (
                <p className="pt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  Missing: {gaps.map((d) => d.toISOString().slice(5, 10)).join(", ")}
                </p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function isHoliday(d: Date) {
  const md = d.toISOString().slice(5, 10);
  return md === "12-25" || md === "01-01";
}
