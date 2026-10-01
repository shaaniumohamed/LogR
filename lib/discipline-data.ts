import { unstable_cache } from "next/cache";
import { loadAnnotations, loadRules } from "@/lib/actions";
import { disciplineDays, judgedNotes, streaks, type DisciplineDay } from "@/lib/core/discipline";
import { accountTrades, insightsTag, tradesTag } from "@/lib/queries";

export interface Discipline {
  hasRules: boolean;
  /** The most recent trading days, oldest first. */
  days: DisciplineDay[];
  current: number;
  best: number;
  /** Over every reviewed day, not just the ones shown. */
  cleanDays: number;
  reviewedDays: number;
}

/**
 * The streak for Home, cached and cleared by anything that could change it:
 * an import (the days), a write-up (the marks), or a rule added or retired
 * (what counts as judged).
 */
export function cachedDiscipline(accountId: string, timeZone: string, show = 30): Promise<Discipline> {
  return unstable_cache(
    async (): Promise<Discipline> => {
      const [trades, notes, rules] = await Promise.all([
        accountTrades(accountId), loadAnnotations(accountId), loadRules(accountId),
      ]);
      const days = disciplineDays(trades, judgedNotes(notes, rules), timeZone);
      const { current, best } = streaks(days);
      const reviewed = days.filter((d) => d.mark !== "unreviewed");
      return {
        hasRules: rules.length > 0,
        days: days.slice(-show),
        current, best,
        cleanDays: reviewed.filter((d) => d.mark === "clean").length,
        reviewedDays: reviewed.length,
      };
    },
    ["discipline", accountId, timeZone, String(show)],
    { tags: [tradesTag(accountId), insightsTag(accountId)], revalidate: 3600 },
  )();
}
