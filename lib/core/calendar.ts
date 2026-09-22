/**
 * Calendar arithmetic, kept pure so it can be tested without a database.
 *
 * Month keys are "YYYY-MM" and day keys are "YYYY-MM-DD", both already in the
 * trader's own zone by the time they get here — every function below treats them
 * as opaque labels rather than converting anything. That matters: the moment a
 * calendar starts re-deriving local days from timestamps it has two answers for
 * what day a trade belongs to, and they disagree across midnight.
 */

/** Step a month key forward or back. Handles the year boundary. */
export function stepMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Every month from first to last, including the ones with no trades in them.
 *
 * A calendar whose arrows only visit months that happen to contain trades is
 * unnavigable — the reader steps back expecting September and lands in July with
 * nothing telling them August was skipped. An empty month is a real answer.
 */
export function monthRange(first: string, last: string): string[] {
  if (first > last) return monthRange(last, first);
  const out: string[] = [];
  for (let m = first; m <= last; m = stepMonth(m, 1)) {
    out.push(m);
    if (out.length > 1200) break; // a century, in case of a corrupt key
  }
  return out;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function dayLabel(date: string, opts: Intl.DateTimeFormatOptions = {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
}): string {
  // Midday UTC so no offset in the world can roll the label onto another date.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

export interface CalendarWeek {
  /** The Monday that starts this week, as a day key. */
  key: string;
  /** Seven entries, Monday first. null where the day falls outside the month. */
  days: (string | null)[];
}

/**
 * A month laid out in Monday-first weeks.
 *
 * Returned as whole weeks rather than a flat run of days so the view can put a
 * total beside each row. Week totals are what turn a calendar from decoration
 * into something you read: the month's shape is usually "one bad week", and that
 * is invisible in thirty separate squares.
 */
export function weeksOfMonth(ym: string): CalendarWeek[] {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  const weeks: CalendarWeek[] = [];
  let cursor = 1 - lead;
  while (cursor <= daysInMonth) {
    const days: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = cursor + i;
      days.push(d >= 1 && d <= daysInMonth ? `${ym}-${String(d).padStart(2, "0")}` : null);
    }
    // The Monday, even when it belongs to the previous month, so the key is stable.
    const monday = new Date(Date.UTC(y, m - 1, cursor));
    weeks.push({ key: monday.toISOString().slice(0, 10), days });
    cursor += 7;
  }
  return weeks;
}

/**
 * The day before or after this one among days that actually have trades.
 *
 * Stepping by calendar day would walk a trader through every Saturday and every
 * holiday they did not trade, which on a five-day market means two dead taps in
 * seven. `days` must be sorted ascending.
 */
export function adjacentTradingDay(days: string[], from: string, dir: -1 | 1): string | null {
  if (dir === 1) return days.find((d) => d > from) ?? null;
  for (let i = days.length - 1; i >= 0; i--) if (days[i] < from) return days[i];
  return null;
}

/** The Monday of the week a day key falls in, as a day key. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Step a week key by whole weeks. */
export function stepWeek(monday: string, by: number): string {
  const d = new Date(`${monday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by * 7);
  return d.toISOString().slice(0, 10);
}

/** The seven day keys of a week, Monday first. */
export function daysOfWeek(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** "15–21 September 2026", collapsing the parts both ends share. */
export function weekLabel(monday: string): string {
  const days = daysOfWeek(monday);
  const a = new Date(`${days[0]}T12:00:00Z`);
  const b = new Date(`${days[6]}T12:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const year = (d: Date) => d.getUTCFullYear();
  if (month(a) === month(b) && year(a) === year(b)) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)} ${year(b)}`;
  }
  if (year(a) === year(b)) {
    return `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)} ${year(b)}`;
  }
  return `${a.getUTCDate()} ${month(a)} ${year(a)} – ${b.getUTCDate()} ${month(b)} ${year(b)}`;
}
