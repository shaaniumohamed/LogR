import { hourIn, localDayKey } from "./metrics";
import { heldOverWeekend, sessionOf, weekdayIn } from "./analysis";
import type { ZoneTrade } from "./types";

/**
 * Your most expensive habits, ranked.
 *
 * Every other screen answers one question at a time — by hour, by feeling, by
 * setup — and leaves the trader to hold eleven screens in their head and work
 * out which finding matters most. This asks all of them at once and puts them
 * in order of what they cost.
 *
 * The hard part is not losing the plot in an account that loses overall. If
 * nearly every trade loses, then nearly every GROUP of trades lost money, and
 * ranking groups by their losses only ranks them by size: "your London trades
 * cost $1,400" says nothing if London trades are no worse than any other.
 *
 * So a habit only becomes a leak if three things are true:
 *
 *   1. its trades lost money in total;
 *   2. they did worse PER TRADE than the rest of your trading; and
 *   3. the gap is too large to be luck, by a two-sample t-test — so a dozen
 *      unlucky trades cannot outrank a pattern that holds across hundreds.
 *
 * Only then is it ranked, and by the plainest true number there is: what you
 * would have kept by not taking those trades at all.
 *
 * The leaks OVERLAP — a rushed trade at 04:00 is in two of them — so they are
 * never added together, and the screen says so.
 */

export interface LeakAnnotation {
  emotion?: string | null;
  mistakes?: string[];
  setup?: string | null;
  rulesBroken?: string[];
}

export interface LeakInput {
  trades: ZoneTrade[];
  timeZone: string;
  annotations?: Map<string, LeakAnnotation>;
  /** Trades opened into a high-impact release, when the calendar is loaded. */
  intoNews?: Set<string>;
  /** Trades opened with under fifteen minutes of the session left. */
  nearClose?: Set<string>;
  /** Plain-language names for stored tag keys. */
  label?: { feeling?: (k: string) => string; mistake?: (k: string) => string; setup?: (k: string) => string };
}

export type LeakFamily =
  | "hour" | "weekday" | "session" | "hold" | "ladder" | "size" | "afterLoss" | "streak"
  | "weekend" | "news" | "close" | "direction" | "feeling" | "mistake" | "setup" | "rules";

export interface Leak {
  key: string;
  family: LeakFamily;
  /** What the habit is, in words a trader would use about themselves. */
  title: string;
  /** What not taking those trades would have saved. Always positive. */
  cost: number;
  n: number;
  groupAvg: number;
  restAvg: number;
  groupWin: number;
  restWin: number;
  /** How sure: "clear" holds up well, "likely" is worth watching. */
  strength: "clear" | "likely";
  /** Trades filter that shows exactly these, where one exists. */
  filter?: Record<string, string>;
}

/** Below this, a group is a handful of trades and says nothing. */
export const LEAK_MIN = 10;

/*
 * How far a group has to sit below the rest before it is believed.
 *
 * Around fifty habits are tested at once, and that changes what a threshold
 * means. At t <= -1, about one group in six passes on pure chance, so a list of
 * five would be mostly noise presented as insight — the seeded test account,
 * whose trade direction is generated completely at random, put "Buying" at the
 * top. At -2, chance lets through roughly one group in forty: across fifty
 * candidates that is about one stray, which the "worth watching" label exists
 * to cover. "Clear" asks for -3, where chance effectively stops.
 */
export const LEAK_T_INCLUDE = -2;
export const LEAK_T_CLEAR = -3;

interface Candidate {
  key: string;
  family: LeakFamily;
  title: string;
  test: (t: ZoneTrade) => boolean;
  filter?: Record<string, string>;
}

/** Families where more than one member can be a separate habit worth naming. */
const MULTI: Partial<Record<LeakFamily, number>> = { feeling: 2, mistake: 2, setup: 2 };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function variance(xs: number[], m: number) {
  if (xs.length < 2) return 0;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

/** Welch's t for the difference in mean result between a group and the rest. */
export function welchT(group: number[], rest: number[]): number {
  const m1 = mean(group), m2 = mean(rest);
  const se = Math.sqrt(variance(group, m1) / group.length + variance(rest, m2) / rest.length);
  if (!Number.isFinite(se) || se === 0) return 0;
  return (m1 - m2) / se;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Per-trade facts that need the neighbours: was it a quick re-entry after a
 * loss, and how many losses in a row came before it on the same day.
 *
 * Computed once, in time order, rather than inside each predicate — a predicate
 * that searched backwards from every trade would be quadratic in the history.
 */
function sequenceFacts(trades: ZoneTrade[], timeZone: string) {
  const byOpen = [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const byClose = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const quickAfterLoss = new Set<string>();
  const afterTwoLosses = new Set<string>();

  /*
   * Walk the opens, and advance a second pointer through the CLOSES that had
   * happened by then. Only a result the trader had already seen can have
   * influenced the next entry: ladders overlap, and walking in opening order
   * alone would count a loss that had not closed yet as the cause of the trade
   * that followed it, which is backwards.
   */
  let p = 0;
  let streak = 0;
  let streakDay = "";
  let lastClosed: ZoneTrade | null = null;
  for (const t of byOpen) {
    while (p < byClose.length && byClose[p].closedAt <= t.openedAt) {
      const c = byClose[p++];
      const cDay = localDayKey(c.closedAt, timeZone);
      if (cDay !== streakDay) { streakDay = cDay; streak = 0; }
      streak = c.netPnl < 0 ? streak + 1 : 0;
      lastClosed = c;
    }
    // Same day only. Yesterday's losing close is not this morning's tilt.
    if (!lastClosed || localDayKey(lastClosed.closedAt, timeZone) !== localDayKey(t.openedAt, timeZone)) continue;

    if (lastClosed.netPnl < 0) {
      const gap = (t.openedAt.getTime() - lastClosed.closedAt.getTime()) / 60_000;
      if (gap <= 5) quickAfterLoss.add(t.id);
    }
    if (streak >= 2) afterTwoLosses.add(t.id);
  }
  return { quickAfterLoss, afterTwoLosses };
}

function candidates(input: LeakInput): Candidate[] {
  const { trades, timeZone, annotations, intoNews, nearClose, label } = input;
  const out: Candidate[] = [];

  // Each trade's local hour and weekday, worked out once. Every hour and every
  // weekday is a candidate, so asking inside the test would format the same
  // timestamp thirty-one times per trade.
  const hourOf = new Map<string, number>();
  const dayOf = new Map<string, string>();
  for (const t of trades) {
    hourOf.set(t.id, hourIn(t.openedAt, timeZone));
    dayOf.set(t.id, weekdayIn(t.openedAt, timeZone));
  }

  for (let h = 0; h < 24; h++) {
    out.push({ key: `hour:${h}`, family: "hour", title: `Trading at ${hh(h)}`,
      test: (t) => hourOf.get(t.id) === h, filter: { hour: String(h) } });
  }
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    out.push({ key: `weekday:${day}`, family: "weekday", title: `Trading on ${day}s`,
      test: (t) => dayOf.get(t.id) === day, filter: { day } });
  }
  for (const s of ["Asia", "London", "New York", "Late"] as const) {
    out.push({ key: `session:${s}`, family: "session", title: `Trading the ${s === "Late" ? "late session" : `${s} session`}`,
      test: (t) => sessionOf(t.openedAt) === s, filter: { session: s } });
  }

  out.push({ key: "hold:long", family: "hold", title: "Holding past 30 minutes",
    test: (t) => t.holdMinutes > 30, filter: { hold: "Over 30 min" } });
  out.push({ key: "ladder:deep", family: "ladder", title: "Building a position from 4 or more entries",
    test: (t) => t.legCount >= 4 });

  const lots = trades.map((t) => t.lots).sort((a, b) => a - b);
  const median = lots.length ? lots[Math.floor(lots.length / 2)] : 0;
  if (median > 0) {
    out.push({ key: "size:big", family: "size", title: "Trading bigger than usual",
      test: (t) => t.lots > median * 1.5 });
  }

  const seq = sequenceFacts(trades, timeZone);
  out.push({ key: "afterLoss:quick", family: "afterLoss", title: "Jumping back in within 5 minutes of a loss",
    test: (t) => seq.quickAfterLoss.has(t.id) });
  out.push({ key: "streak:2", family: "streak", title: "Carrying on after two losses in a row",
    test: (t) => seq.afterTwoLosses.has(t.id) });

  out.push({ key: "weekend", family: "weekend", title: "Holding through the weekend",
    test: (t) => heldOverWeekend(t.openedAt, t.closedAt), filter: { result: "weekend" } });
  if (intoNews) {
    out.push({ key: "news", family: "news", title: "Trading into high-impact news",
      test: (t) => intoNews.has(t.id), filter: { news: "in" } });
  }
  if (nearClose) {
    out.push({ key: "close", family: "close", title: "Opening in the last 15 minutes before the close",
      test: (t) => nearClose.has(t.id) });
  }
  out.push({ key: "direction:long", family: "direction", title: "Buying",
    test: (t) => t.direction === "long", filter: { direction: "long" } });
  out.push({ key: "direction:short", family: "direction", title: "Selling",
    test: (t) => t.direction === "short", filter: { direction: "short" } });

  if (annotations?.size) {
    const feelings = new Set<string>(), mistakes = new Set<string>(), setups = new Set<string>();
    for (const a of annotations.values()) {
      if (a.emotion) feelings.add(a.emotion);
      for (const m of a.mistakes ?? []) mistakes.add(m);
      if (a.setup) setups.add(a.setup);
    }
    for (const f of feelings) {
      out.push({ key: `feeling:${f}`, family: "feeling",
        title: `Trading while ${(label?.feeling?.(f) ?? f).toLowerCase()}`,
        test: (t) => annotations.get(t.id)?.emotion === f, filter: { emotion: f } });
    }
    for (const m of mistakes) {
      out.push({ key: `mistake:${m}`, family: "mistake", title: label?.mistake?.(m) ?? m,
        test: (t) => (annotations.get(t.id)?.mistakes ?? []).includes(m), filter: { mistake: m } });
    }
    for (const s of setups) {
      out.push({ key: `setup:${s}`, family: "setup", title: `${label?.setup?.(s) ?? s} trades`,
        test: (t) => annotations.get(t.id)?.setup === s, filter: { setup: s } });
    }
    out.push({ key: "rules", family: "rules", title: "Breaking one of your own rules",
      test: (t) => (annotations.get(t.id)?.rulesBroken ?? []).length > 0 });
  }
  return out;
}

/** Ranked leaks, most expensive first. */
export function findLeaks(input: LeakInput, limit = 5): Leak[] {
  const { trades } = input;
  if (trades.length < LEAK_MIN * 2) return [];

  const found: (Leak & { t: number })[] = [];
  for (const c of candidates(input)) {
    const group: number[] = [], rest: number[] = [];
    let groupWins = 0, restWins = 0;
    for (const t of trades) {
      if (c.test(t)) { group.push(t.netPnl); if (t.netPnl > 0) groupWins++; }
      else { rest.push(t.netPnl); if (t.netPnl > 0) restWins++; }
    }
    if (group.length < LEAK_MIN || rest.length < LEAK_MIN) continue;

    const groupNet = group.reduce((a, b) => a + b, 0);
    const groupAvg = groupNet / group.length;
    const restAvg = mean(rest);
    if (groupNet >= 0 || groupAvg >= restAvg) continue;

    const t = welchT(group, rest);
    if (t > LEAK_T_INCLUDE) continue;

    found.push({
      key: c.key, family: c.family, title: c.title, filter: c.filter,
      cost: Math.round(-groupNet * 100) / 100,
      n: group.length,
      groupAvg, restAvg,
      groupWin: groupWins / group.length,
      restWin: restWins / rest.length,
      strength: t <= LEAK_T_CLEAR ? "clear" : "likely",
      t,
    });
  }

  // One per family, or two for the tag families, so the list names five
  // different habits rather than five neighbouring hours of the same one.
  found.sort((a, b) => b.cost - a.cost);
  const perFamily = new Map<LeakFamily, number>();
  const out: Leak[] = [];
  for (const f of found) {
    const used = perFamily.get(f.family) ?? 0;
    if (used >= (MULTI[f.family] ?? 1)) continue;
    perFamily.set(f.family, used + 1);
    const { t: _t, ...leak } = f;
    void _t;
    out.push(leak);
    if (out.length >= limit) break;
  }
  return out;
}
