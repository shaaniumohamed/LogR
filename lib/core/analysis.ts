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

export function sessionOf(hour: number): string {
  if (hour < 7) return "Asia";
  if (hour < 13) return "London";
  if (hour < 18) return "New York";
  return "Late";
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
