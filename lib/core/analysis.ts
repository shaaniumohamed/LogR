import type { ZoneTrade } from "./types";
import { computeStats, hourIn, localDayKey } from "./metrics";
import { round2 } from "./parse-exness";

/**
 * Higher-level analyses built on the metrics primitives. Each returns the number
 * AND the context a reader needs to judge it — sample size, and how consistent
 * the pattern was across days. An aggregate alone can be one catastrophic day
 * wearing a pattern's clothing.
 */

export interface HourBucket {
  hour: number;
  label: string;
  trades: number;
  net: number;
  /** Days this hour was traded, and how many of them lost money. */
  days: number;
  losingDays: number;
  /** True when it lost on most days it was traded, not just in total. */
  consistent: boolean;
}

export function byHourLocal(trades: ZoneTrade[], timeZone: string): HourBucket[] {
  const buckets = new Map<number, ZoneTrade[]>();
  for (const t of trades) {
    const h = hourIn(t.openedAt, timeZone);
    if (!buckets.has(h)) buckets.set(h, []);
    buckets.get(h)!.push(t);
  }

  return [...buckets.entries()]
    .map(([hour, items]) => {
      const perDay = new Map<string, number>();
      for (const t of items) {
        const k = localDayKey(t.openedAt, timeZone);
        perDay.set(k, (perDay.get(k) ?? 0) + t.netPnl);
      }
      const days = perDay.size;
      const losingDays = [...perDay.values()].filter((v) => v < 0).length;
      const net = round2(items.reduce((s, t) => s + t.netPnl, 0));
      return {
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        trades: items.length,
        net,
        days,
        losingDays,
        consistent: net < 0 && days >= 3 && losingDays / days > 0.5,
      };
    })
    .sort((a, b) => a.hour - b.hour);
}

/** Daily totals in the trader's own timezone, oldest first. */
export function byLocalDay(trades: ZoneTrade[], timeZone: string) {
  const m = new Map<string, ZoneTrade[]>();
  for (const t of trades) {
    const k = localDayKey(t.closedAt, timeZone);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()]
    .map(([date, items]) => ({
      date,
      trades: items.length,
      net: round2(items.reduce((s, t) => s + t.netPnl, 0)),
      stats: computeStats(items),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * What the period looks like without a chosen slice.
 *
 * Deliberately reports removals in BOTH directions. Testing this on real data
 * produced a bucket that intuition called bad and that was in fact carrying
 * profit, so a panel that only surfaces leaks would have been misleading.
 */
export function counterfactual(trades: ZoneTrade[], predicate: (t: ZoneTrade) => boolean) {
  const removed = trades.filter(predicate);
  const kept = trades.filter((t) => !predicate(t));
  const removedNet = round2(removed.reduce((s, t) => s + t.netPnl, 0));
  const total = round2(trades.reduce((s, t) => s + t.netPnl, 0));
  return {
    removedCount: removed.length,
    removedNet,
    before: total,
    after: round2(total - removedNet),
    /** Positive means dropping this slice would have helped. */
    improvement: round2(-removedNet),
  };
}

export function holdBucket(minutes: number): string {
  if (minutes < 1) return "Under 1 min";
  if (minutes < 3) return "1–3 min";
  if (minutes < 10) return "3–10 min";
  if (minutes < 30) return "10–30 min";
  return "Over 30 min";
}

export const SESSIONS = ["Asia", "London", "New York", "Late"] as const;
export type Session = (typeof SESSIONS)[number];

/**
 * Which trading session an instant falls in.
 *
 * Read off UTC, never off the trader's own clock. A session is a fact about
 * where in the world the desks are open, not about what time it is where the
 * trader is sitting — and this function previously took a local hour, which
 * made every label wrong by the size of the trader's offset. At UTC+8 the
 * trades it filed under "Asia" (local 00:00–06:59) had actually been taken
 * between 16:00 and 23:00 UTC, which is the New York afternoon: the two busiest
 * labels were the wrong way round. It also meant a friend in London and a
 * friend in Kuala Lumpur reading the same market got different answers.
 *
 * Boundaries are the hours the sessions genuinely overlap the least. They are
 * approximate to within an hour across daylight saving, which no fixed boundary
 * can avoid and which is far smaller than the error being fixed.
 */
export function sessionOf(at: Date): Session {
  const h = at.getUTCHours();
  if (h < 7) return "Asia";        // Tokyo's morning
  if (h < 13) return "London";     // London's morning, before New York arrives
  if (h < 21) return "New York";   // the overlap and the US afternoon
  return "Late";                   // Sydney opening, thinnest of the day
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(date);
}

/** ISO week key (YYYY-Www) in the trader's own zone, Monday-first. */
export function weekKey(date: Date, timeZone: string): string {
  const day = localDayKey(date, timeZone);
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function monthKey(date: Date, timeZone: string): string {
  return localDayKey(date, timeZone).slice(0, 7);
}

const DAY_MS = 86_400_000;

/**
 * Was this position open while the market was shut for the weekend?
 *
 * Worth knowing on its own, because a position held through a closure is not
 * the trade that was entered. Nothing can be managed, no invalidation can be
 * respected, and the position reopens wherever the world decided over two days
 * — which is how a scalp with a mental stop becomes a two-hundred-point loss
 * that was never a decision.
 *
 * Detected against Saturday UTC rather than against session hours. Gold and FX
 * are shut for the whole of it whatever the season, so the test cannot report a
 * closure that did not happen; session boundaries move with daylight saving and
 * differ by broker, and being approximately right about those would be worse
 * than being exactly right about this.
 */
export function heldOverWeekend(openedAt: Date, closedAt: Date): boolean {
  if (closedAt <= openedAt) return false;
  const dayStart = Date.UTC(openedAt.getUTCFullYear(), openedAt.getUTCMonth(), openedAt.getUTCDate());
  const untilSaturday = (6 - new Date(dayStart).getUTCDay() + 7) % 7;
  const saturday = dayStart + untilSaturday * DAY_MS;
  return openedAt.getTime() < saturday + DAY_MS && closedAt.getTime() > saturday;
}

export interface DayShape {
  /** Cumulative profit at each exit, in the order the exits happened. */
  curve: number[];
  /** The best the day ever was, and when. */
  peak: number;
  peakAt: Date | null;
  worst: number;
  worstAt: Date | null;
  close: number;
  /**
   * The fall from the day's best point to where it finished. Always a fall, never
   * a gain — on a day that was never green it is how much worse than its best the
   * day ended, which is a real thing to see but is not profit handed back.
   */
  gaveBack: number;
  /** True only when a genuine profit was handed back: the sentence-worthy case. */
  gaveBackMost: boolean;
}

/**
 * The shape of a single day, not just its total.
 *
 * A day that ends at +$40 having been +$300 is a completely different day from
 * one that climbed steadily to +$40, and the daily total — the number every
 * journal shows — cannot tell them apart. At a hundred orders a day the
 * difference between those two is the whole of a trader's discipline: it is the
 * record of what happened after the day was already won.
 *
 * Ordered by exit, because that is when money actually moved.
 */
export function dayShape(trades: ZoneTrade[]): DayShape {
  const sorted = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const curve: number[] = [];
  let running = 0, peak = 0, worst = 0;
  let peakAt: Date | null = null, worstAt: Date | null = null;

  for (const t of sorted) {
    running = round2(running + t.netPnl);
    curve.push(running);
    if (peakAt === null || running > peak) { peak = running; peakAt = t.closedAt; }
    if (worstAt === null || running < worst) { worst = running; worstAt = t.closedAt; }
  }

  const close = curve.length ? curve[curve.length - 1] : 0;
  const gaveBack = round2(Math.max(0, peak - close));
  return {
    curve, peak, peakAt, worst, worstAt, close, gaveBack,
    // Half of a peak worth having. A dollar handed back off two dollars is noise;
    // handing back half of a real gain is the thing worth seeing.
    gaveBackMost: peak > 0 && gaveBack > peak * 0.5 && gaveBack > 1,
  };
}

export interface TagContrast {
  key: string;
  /** Times this tag appears at all, across winners and losers. */
  seen: number;
  winners: number;
  losers: number;
  /** Share of the WINNING trades that carried it, and of the losing ones. */
  inWinners: number;
  inLosers: number;
  /** inWinners − inLosers. Positive means it shows up more when things work. */
  lift: number;
}

/**
 * Which of your own tags separate the trades that worked from the ones that did not.
 *
 * The question every confluence checklist is really asking and no journal
 * answers: of the eight things you look for before entering, which ones are
 * actually present more often when the trade works? Counting how often a tag
 * appears overall cannot tell you — the tags you believe in are the ones you
 * look for hardest, so they appear everywhere.
 *
 * Comparing its share of winners against its share of losers can. A tag on 70%
 * of winners and 20% of losers is doing work. A tag on 80% of both is a habit,
 * not an edge, and knowing that is worth as much: it is time back on every
 * chart you read.
 *
 * `minSeen` keeps out tags used so rarely that one trade would swing them. This
 * is a description of what happened, not a prediction — the caveat belongs
 * wherever it is shown.
 */
export function tagContrast(
  items: { won: boolean; tags: string[] }[],
  minSeen = 5,
): TagContrast[] {
  const wins = items.filter((i) => i.won).length;
  const losses = items.length - wins;
  if (!wins || !losses) return [];

  const counts = new Map<string, { w: number; l: number }>();
  for (const i of items) {
    // A tag applied twice to one trade still only describes one trade.
    for (const tag of new Set(i.tags)) {
      const c = counts.get(tag) ?? { w: 0, l: 0 };
      if (i.won) c.w++; else c.l++;
      counts.set(tag, c);
    }
  }

  return [...counts.entries()]
    .filter(([, c]) => c.w + c.l >= minSeen)
    .map(([key, c]) => {
      const inWinners = c.w / wins;
      const inLosers = c.l / losses;
      return {
        key, seen: c.w + c.l, winners: c.w, losers: c.l,
        inWinners, inLosers, lift: round2(inWinners - inLosers),
      };
    })
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
}

export interface GridCell {
  day: string;
  /** First hour of the bucket, in the trader's own clock. */
  hour: number;
  trades: number;
  net: number;
}

export interface HourGrid {
  cells: GridCell[];
  /** Bucket start hours that were actually traded, ascending. */
  hours: number[];
  days: string[];
  bucketHours: number;
  /** Largest absolute net in any cell, for scaling colour. */
  scale: number;
}

const GRID_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Day of the week against time of day, as a grid.
 *
 * Both dimensions already have their own chart and neither can show what this
 * shows. "Fridays are bad" and "the afternoon is bad" are different claims from
 * "Friday afternoons are bad", and only the third is a rule anyone can follow.
 * For someone taking a hundred orders a day across a full session, the
 * interaction is where the actionable finding lives — a single hour on a single
 * weekday is a thing you can simply decide not to trade.
 *
 * Bucketed rather than hour-by-hour because twenty-four columns on a phone are
 * fifteen pixels wide, and a cell too small to print its own value in would
 * leave colour carrying the meaning alone.
 */
export function hourWeekdayGrid(
  trades: ZoneTrade[],
  timeZone: string,
  bucketHours = 2,
): HourGrid {
  const acc = new Map<string, GridCell>();
  const hoursUsed = new Set<number>();
  const daysUsed = new Set<string>();

  for (const t of trades) {
    const day = weekdayIn(t.openedAt, timeZone);
    const hour = Math.floor(hourIn(t.openedAt, timeZone) / bucketHours) * bucketHours;
    const key = `${day}|${hour}`;
    const cell = acc.get(key) ?? { day, hour, trades: 0, net: 0 };
    cell.trades += 1;
    cell.net = round2(cell.net + t.netPnl);
    acc.set(key, cell);
    hoursUsed.add(hour);
    daysUsed.add(day);
  }

  const cells = [...acc.values()];
  return {
    cells,
    hours: [...hoursUsed].sort((a, b) => a - b),
    days: GRID_DAYS.filter((d) => daysUsed.has(d)),
    bucketHours,
    scale: Math.max(...cells.map((c) => Math.abs(c.net)), 1),
  };
}

export interface Drawdown {
  /** How far the running total fell from its high point, as a positive number. */
  depth: number;
  peakAt: string;
  troughAt: string;
  /** Null while the account has not yet climbed back above the old high. */
  recoveredAt: string | null;
  /** Days from the peak to the trough. */
  days: number;
}

/**
 * The deepest fall from a high point, measured on the daily running total.
 *
 * A standard figure and a conspicuous absence here. It answers the question the
 * equity curve only hints at: how bad has this already been, and how long did it
 * take. On an account traded without platform stops that is not an abstraction —
 * it is the size of the hole a mental stop has actually let open once.
 */
export function maxDrawdown(days: { date: string; net: number }[]): Drawdown | null {
  if (days.length < 2) return null;

  let running = 0, peak = 0, peakAt = days[0].date;
  let best: Drawdown | null = null;

  for (const d of days) {
    running = round2(running + d.net);
    if (running >= peak) { peak = running; peakAt = d.date; continue; }
    const depth = round2(peak - running);
    if (!best || depth > best.depth) {
      const from = new Date(`${peakAt}T00:00:00Z`).getTime();
      const to = new Date(`${d.date}T00:00:00Z`).getTime();
      best = {
        depth, peakAt, troughAt: d.date, recoveredAt: null,
        days: Math.round((to - from) / DAY_MS),
      };
    }
  }

  if (best) {
    // Walk the same series once more to find the first day after the trough that
    // climbed back above the old high. Null means it never has, which is the
    // more important of the two answers and so is never quietly omitted.
    let run = 0, highWater = 0, passedTrough = false;
    for (const d of days) {
      run = round2(run + d.net);
      if (d.date <= best.peakAt) highWater = Math.max(highWater, run);
      if (d.date === best.troughAt) { passedTrough = true; continue; }
      if (passedTrough && run >= highWater) { best.recoveredAt = d.date; break; }
    }
  }

  return best;
}
