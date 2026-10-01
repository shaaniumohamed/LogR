import { localDayKey } from "./metrics";

/**
 * Rules kept or broken, one trading day at a time.
 *
 * The Playbook gives one discipline percentage across everything; this turns
 * it into a run of days, because a streak is something a trader can protect
 * tonight, and a percentage over five months is not.
 *
 * A trade is JUDGED against your rules only if you wrote it up after your first
 * rule existed — the form only offers the rules in force at the time, so an
 * earlier note could not have recorded breaking one. That is the Playbook's
 * definition too, and it lives here so the two can never disagree.
 */

export interface DisciplineNote {
  identityHash: string;
  updatedAt: Date;
  rulesBroken: string[];
  note?: string | null;
  setup?: string | null;
  emotion?: string | null;
  confluences?: string[];
  mistakes?: string[];
}

/** A note that actually says something, rather than an empty row. */
export function isWritten(a: DisciplineNote): boolean {
  return !!(a.note || a.setup || a.emotion || a.confluences?.length || a.mistakes?.length || a.rulesBroken?.length);
}

/** Notes that were written with rules in force, so can be read as kept or broken. */
export function judgedNotes(notes: DisciplineNote[], rules: { createdAt: Date }[]): DisciplineNote[] {
  if (!rules.length) return [];
  const earliest = rules.reduce((a, b) => (b.createdAt < a.createdAt ? b : a)).createdAt;
  return notes.filter((a) => isWritten(a) && a.updatedAt >= earliest);
}

export type DayMark = "clean" | "broken" | "unreviewed";

export interface DisciplineDay {
  day: string;
  mark: DayMark;
  trades: number;
  judged: number;
  broken: number;
  net: number;
}

/**
 * Every trading day, oldest first, with its mark.
 *
 * Days are the same days the calendar shows — by close, in the trader's zone —
 * so a dot here and a square there always describe the same trades.
 */
export function disciplineDays(
  trades: { id: string; closedAt: Date; netPnl: number }[],
  judged: DisciplineNote[],
  timeZone: string,
): DisciplineDay[] {
  const byHash = new Map(judged.map((a) => [a.identityHash, a]));
  const days = new Map<string, DisciplineDay>();
  for (const t of trades) {
    const day = localDayKey(t.closedAt, timeZone);
    const d = days.get(day) ?? { day, mark: "unreviewed" as DayMark, trades: 0, judged: 0, broken: 0, net: 0 };
    d.trades++;
    d.net += t.netPnl;
    const a = byHash.get(t.id);
    if (a) {
      d.judged++;
      if (a.rulesBroken.length) d.broken++;
    }
    days.set(day, d);
  }
  for (const d of days.values()) d.mark = d.broken ? "broken" : d.judged ? "clean" : "unreviewed";
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The current clean run and the longest one.
 *
 * An unreviewed day ENDS the current run rather than being skipped over. If
 * not writing a day up let a streak carry on through it, the easiest way to
 * protect a streak would be to stop reviewing — the opposite of what it is for.
 * Writing the day up is how the run continues.
 */
export function streaks(days: DisciplineDay[]): { current: number; best: number } {
  let current = 0;
  for (let i = days.length - 1; i >= 0 && days[i].mark === "clean"; i--) current++;
  let best = 0, run = 0;
  for (const d of days) {
    run = d.mark === "clean" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}
