import { zonedTime } from "./zones";

/**
 * High-impact economic releases, and whether a trade was taken in one.
 *
 * This matters more for gold than for almost anything else. A dollar release
 * moves XAUUSD several dollars in a few seconds, spreads widen to many times
 * their normal width, and a level that has held all week stops meaning anything
 * for twenty minutes. The journal already has a "news" confluence tag and a
 * "news reaction" setup, and both are currently self-reported — which is to say
 * remembered, which is to say wrong about the trades that matter most.
 *
 * Nothing here guesses. An event is in the database because it was derived from
 * a rule that is exactly true, or because the trader imported a calendar.
 */

export type Impact = "high" | "medium" | "low";

export interface NewsEvent {
  at: Date;
  /** The currency the release belongs to: USD, EUR, and so on. */
  currency: string;
  title: string;
  impact: Impact;
  source: string;
}

/**
 * Thirty minutes either side.
 *
 * Chosen because it is roughly how long a gold spread takes to come back to
 * normal after a US release, and because it is a window a trader can actually
 * act on: "nothing new in the half hour around a red-folder event" is a rule,
 * whereas "be careful near news" is a feeling.
 */
export const NEWS_WINDOW_MINUTES = 30;

/**
 * Non-farm payrolls, derived rather than fetched.
 *
 * The only major release whose timing is a rule rather than a calendar entry:
 * the first Friday of the month, half past eight in New York. That makes it the
 * one event the app can know about for a trader's whole history without anyone
 * importing anything — which matters, because a feed covers the coming week and
 * the question here is always about the past.
 *
 * Half past eight NEW YORK, not half past one UTC: the gap between those is an
 * hour for four months of the year, and an hour is two of these windows.
 */
export function payrollDates(fromYear: number, toYear: number): NewsEvent[] {
  const out: NewsEvent[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const first = new Date(Date.UTC(y, m - 1, 1));
      // 5 = Friday, in getUTCDay terms.
      const day = 1 + ((5 - first.getUTCDay() + 7) % 7);
      out.push({
        at: zonedTime(y, m, day, 8, 30, "America/New_York"),
        currency: "USD",
        title: "US non-farm payrolls",
        impact: "high",
        source: "derived",
      });
    }
  }
  return out;
}

export interface WindowHit {
  /** The nearest qualifying event, or null. */
  event: NewsEvent | null;
  /** Signed minutes from the event to the trade: negative means before it. */
  minutesFrom: number | null;
}

/**
 * Was this instant inside the window of a qualifying release?
 *
 * `events` must be sorted by time; the caller sorts once and asks many times,
 * because this runs over every trade on the account.
 */
export function newsWindow(
  at: Date,
  events: NewsEvent[],
  minutes = NEWS_WINDOW_MINUTES,
  impacts: Impact[] = ["high"],
): WindowHit {
  const t = at.getTime();
  const span = minutes * 60_000;

  // Binary search to the first event at or after the window's start, so a
  // hundred thousand trades against a thousand events stays cheap.
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].at.getTime() < t - span) lo = mid + 1; else hi = mid;
  }

  let best: NewsEvent | null = null;
  let bestGap = Infinity;
  for (let i = lo; i < events.length; i++) {
    const gap = events[i].at.getTime() - t;
    if (gap > span) break;
    if (!impacts.includes(events[i].impact)) continue;
    if (Math.abs(gap) < Math.abs(bestGap)) { best = events[i]; bestGap = gap; }
  }

  return best
    ? { event: best, minutesFrom: Math.round(-bestGap / 60_000) }
    : { event: null, minutesFrom: null };
}

/* ------------------------------------------------------- calendar import */

const IMPACT_WORDS: Record<string, Impact> = {
  high: "high", red: "high", "3": "high",
  medium: "medium", orange: "medium", amber: "medium", "2": "medium",
  low: "low", yellow: "low", "1": "low",
  holiday: "low", none: "low", "0": "low",
};

const HEADERS: Record<string, string[]> = {
  date: ["date", "day", "datetime", "date time", "start"],
  time: ["time", "hour"],
  currency: ["currency", "country", "ccy", "symbol"],
  impact: ["impact", "importance", "volatility", "folder"],
  title: ["title", "event", "name", "description"],
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** `8:30am`, `08:30`, `13:30:00`, `All Day`, `Tentative`. */
function parseClock(raw: string): { h: number; m: number } | null {
  const s = raw.trim().toLowerCase();
  if (!s || /all\s*day|tentative|holiday/.test(s)) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h > 23 || Number(m[2]) > 59 ? null : { h, m: Number(m[2]) };
}

/** `2026-09-18`, `18/09/2026`, `09-18-2026`, `Sep 18 2026`. */
function parseDay(raw: string): { y: number; mo: number; d: number } | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    // A value above twelve can only be the day, which settles the order; when
    // both are ambiguous, assume month-first, since that is what the calendar
    // sites that produce these files emit.
    return a > 12 ? { y: +m[3], mo: b, d: a } : { y: +m[3], mo: a, d: b };
  }

  const parsed = Date.parse(`${s} UTC`);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  return null;
}

export interface CalendarParse {
  events: NewsEvent[];
  /** Rows that could not be read, for reporting rather than for silence. */
  skipped: number;
  rows: number;
}

/**
 * A calendar CSV from wherever the trader gets one.
 *
 * Format-agnostic for the same reason the candle parser is: every calendar site
 * emits a different shape, and the times are in whatever zone the site happened
 * to be set to — which is why `zone` is required rather than guessed. An
 * economic release imported an hour out is worse than one not imported at all,
 * because it looks like an answer.
 */
export function parseCalendarCsv(text: string, zone: string): CalendarParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { events: [], skipped: 0, rows: 0 };

  const sep = [",", ";", "\t"]
    .map((s) => ({ s, n: lines[0].split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s;

  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z ]/g, "").trim());
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADERS)) {
    col[field] = head.findIndex((h) => aliases.includes(h));
  }
  // No recognisable header means there is nothing to key on, and positional
  // guessing at a calendar file would be inventing data.
  if (col.title < 0 || col.date < 0) return { events: [], skipped: lines.length, rows: lines.length };

  const events: NewsEvent[] = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const day = parseDay(cells[col.date] ?? "");
    const title = (cells[col.title] ?? "").trim();
    if (!day || !title) { skipped++; continue; }

    // A date column may already carry the time; otherwise there is a column.
    const clock = parseClock(cells[col.time] ?? "")
      ?? parseClock((cells[col.date] ?? "").split(/[ T]/)[1] ?? "");
    if (!clock) { skipped++; continue; }   // all-day and tentative entries have no window

    const impactRaw = (cells[col.impact] ?? "high").trim().toLowerCase();
    const impact = IMPACT_WORDS[impactRaw] ?? IMPACT_WORDS[impactRaw.split(/\s+/)[0]] ?? "medium";
    const currency = (cells[col.currency] ?? "USD").trim().toUpperCase().slice(0, 8) || "USD";

    events.push({
      at: zonedTime(day.y, day.mo, day.d, clock.h, clock.m, zone),
      currency, title: title.slice(0, 140), impact, source: "csv",
    });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { events, skipped, rows: lines.length - 1 };
}
