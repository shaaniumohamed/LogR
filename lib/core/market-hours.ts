/**
 * When the market was shut, worked out from the price data rather than a
 * calendar.
 *
 * The question this exists to answer is one the trader raised about their own
 * losses: "some of those were because I entered near the close." That is
 * measurable, but only if the app knows when the close was — and a hardcoded
 * table of session hours is the wrong way to know it. Exness runs its own
 * server clock, gold has a break every night whose wall-clock time moves twice
 * a year with daylight saving, and both differ from the next broker's. A table
 * would be wrong somewhere, silently, and wrong in a way that turns a finding
 * into a fiction.
 *
 * The hourly bars already know. A market that is shut prints no bars, so a
 * closure is a hole in the series — the same reasoning closureGapIn uses for a
 * weekend inside a single trade, applied to the whole period instead.
 *
 * It must be the HOURLY series and not the minute one. Minute coverage here is
 * deliberately patchy — days are fetched when a trade needs them — so a hole in
 * it means nothing at all. The hourly table is filled in bulk, years per call,
 * which is what makes an absence evidence rather than an artefact.
 */

export interface Closure {
  /** Epoch seconds when trading stopped: the end of the last bar before the hole. */
  startSec: number;
  /** Epoch seconds when it resumed: the start of the first bar after. */
  endSec: number;
  hours: number;
  /** A weekend rather than the nightly break — a different risk, and a different sentence. */
  weekend: boolean;
}

/** Below this a gap is the nightly break; above it, the week has ended. */
const WEEKEND_HOURS = 12;

/**
 * Every closure in an hourly series.
 *
 * Two details decide whether the answer is right.
 *
 * The closure starts at the END of the last bar before the hole, not at its
 * timestamp. A bar stamped 21:00 covers 21:00–22:00, so a market that goes
 * quiet after it shut at 22:00 — and a trade opened at 21:40 had twenty minutes
 * left, not minus forty. Using the stamp would have understated every answer by
 * one whole bar.
 *
 * And a hole is only believed when it repeats. One missing bar from the data
 * provider looks exactly like an hour-long closure, and would invent a close
 * that never happened on whatever trade sat next to it. A real nightly break
 * lands at the same hour night after night, so a short hole is kept only when
 * its hour recurs across several days. A weekend needs no such proof: nothing
 * else leaves the market dark for half a day.
 */
export function closuresIn(
  bars: { time: number }[],
  barSeconds = 3600,
  minRecurrences = 3,
): Closure[] {
  const candidates: Closure[] = [];
  for (let i = 1; i < bars.length; i++) {
    const startSec = bars[i - 1].time + barSeconds;
    const endSec = bars[i].time;
    const hours = (endSec - startSec) / 3600;
    if (hours <= 0) continue;
    candidates.push({ startSec, endSec, hours, weekend: hours >= WEEKEND_HOURS });
  }

  // How many DIFFERENT days each closing hour was seen on. Counting days rather
  // than closures stops one noisy stretch from vouching for itself.
  const daysPerHour = new Map<number, Set<string>>();
  for (const c of candidates) {
    if (c.weekend) continue;
    const d = new Date(c.startSec * 1000);
    const hour = d.getUTCHours();
    const day = d.toISOString().slice(0, 10);
    if (!daysPerHour.has(hour)) daysPerHour.set(hour, new Set());
    daysPerHour.get(hour)!.add(day);
  }

  return candidates.filter((c) =>
    c.weekend || (daysPerHour.get(new Date(c.startSec * 1000).getUTCHours())?.size ?? 0) >= minRecurrences
  );
}

/**
 * Nothing legitimate puts a gold trader more than a day from the next close, so
 * a bigger answer than this means the bars have a hole where a break should be.
 * Saying nothing beats saying something made of missing data.
 */
const MAX_PLAUSIBLE_HOURS = 24;

export interface EntryTiming {
  /** Trading minutes between opening the position and the market shutting. */
  minutesLeft: number;
  closure: Closure;
}

/** How much of the session was left when this trade was opened, or null if unknowable. */
export function sessionLeftAt(atSec: number, closures: Closure[]): EntryTiming | null {
  const next = closures.find((c) => c.startSec > atSec);
  if (!next) return null;
  const minutesLeft = (next.startSec - atSec) / 60;
  if (minutesLeft > MAX_PLAUSIBLE_HOURS * 60) return null;
  return { minutesLeft, closure: next };
}

/**
 * Buckets chosen against how this account actually trades: a median hold of
 * about five minutes. An hour of room is a different world from ten minutes of
 * it, while the difference between six hours and eight is nothing at all —
 * so the short end is where the edges are.
 */
export const LEFT_BUCKETS = [
  { label: "under 15 minutes", max: 15 },
  { label: "15 to 60 minutes", max: 60 },
  { label: "1 to 4 hours", max: 240 },
  { label: "over 4 hours", max: Infinity },
] as const;

export function leftBucket(minutesLeft: number): string {
  return (LEFT_BUCKETS.find((b) => minutesLeft < b.max) ?? LEFT_BUCKETS[LEFT_BUCKETS.length - 1]).label;
}

/** Was the position still open when the market shut? That is the mechanism, not the clock. */
export function caughtByClose(closedAtSec: number, timing: EntryTiming): boolean {
  return closedAtSec >= timing.closure.startSec;
}
