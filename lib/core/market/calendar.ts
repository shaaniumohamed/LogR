/**
 * Days the gold market is shut on a weekday.
 *
 * Spot gold follows the US metals calendar for full-day closures: Good Friday,
 * Christmas Day and New Year's Day, with a holiday that falls on a Saturday
 * taken on the Friday before and one that falls on a Sunday taken on the
 * Monday after. Other US holidays (Thanksgiving, Independence Day…) only
 * shorten the session, so they are not here.
 *
 * Brokers do not all close on the "moved" days — Exness traded 26 December
 * 2022 — so a caller should treat these as "expected to be empty", not as
 * "must be empty".
 */

/** Easter Sunday (Gregorian), as [month 1–12, day]. Anonymous Gregorian algorithm. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function goodFriday(year: number): string {
  const [m, d] = easterSunday(year);
  return iso(year, m, d - 2);
}

/** The holiday's name if the market is normally shut on this UTC day (YYYY-MM-DD), else null. */
export function marketHoliday(day: string): string | null {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear(), md = day.slice(5), wd = date.getUTCDay();
  if (md === "12-25") return "Christmas Day";
  if (md === "01-01") return "New Year's Day";
  if (day === goodFriday(y)) return "Good Friday";
  // Saturday holiday → Friday before; Sunday holiday → Monday after.
  if (md === "12-24" && wd === 5) return "Christmas (taken on the Friday)";
  if (md === "12-26" && wd === 1) return "Christmas (taken on the Monday)";
  if (md === "12-31" && wd === 5) return "New Year (taken on the Friday)";
  if (md === "01-02" && wd === 1) return "New Year (taken on the Monday)";
  return null;
}
