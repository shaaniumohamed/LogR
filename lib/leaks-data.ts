import { loadAnnotations } from "@/lib/actions";
import { loadEvents } from "@/lib/news";
import { loadHtfBars } from "@/lib/candles";
import { newsWindow, type NewsEvent } from "@/lib/core/news";
import { closuresIn, sessionLeftAt } from "@/lib/core/market-hours";
import { findLeaks, type Leak, type LeakAnnotation } from "@/lib/core/leaks";
import { feelingLabel, mistakeLabel } from "@/lib/core/taxonomy";
import type { ZoneTrade } from "@/lib/core/types";

/**
 * Everything the leak ranking can use, for a set of trades already loaded.
 *
 * Three reads, started together, none depending on the others: what the
 * trader wrote about each trade, the news calendar over the span, and the
 * hourly series the closes are read from. Each one only widens what can be
 * tested — a trader who has never tagged a trade still gets the timing and
 * behaviour leaks, which need nothing but the fills.
 */
export async function leaksFor(
  trades: ZoneTrade[],
  timeZone: string,
  accountId: string,
  limit = 5,
): Promise<Leak[]> {
  if (trades.length < 20) return [];

  // Trades arrive newest first.
  const from = trades[trades.length - 1].openedAt;
  const to = trades[0].closedAt;
  const symbol = mostTraded(trades);

  const [annotations, events, hourly] = await Promise.all([
    loadAnnotations(accountId),
    loadEvents(new Date(from.getTime() - 3600_000), new Date(to.getTime() + 3600_000)),
    loadHtfBars(symbol, "1h", new Date(from.getTime() - 2 * 86_400_000), new Date(to.getTime() + 2 * 86_400_000)),
  ]);

  return leaksFrom(trades, timeZone, annotations, events, hourly, limit);
}

/** The same ranking, for a page that has already loaded the inputs itself. */
export function leaksFrom(
  trades: ZoneTrade[],
  timeZone: string,
  annotations: { identityHash: string; emotion: string | null; mistakes: string[]; setup: string | null; rulesBroken: string[] }[],
  events: NewsEvent[],
  hourly: { time: number }[],
  limit = 5,
): Leak[] {
  const byHash = new Map<string, LeakAnnotation>(annotations.map((a) => [a.identityHash, {
    emotion: a.emotion, mistakes: a.mistakes, setup: a.setup, rulesBroken: a.rulesBroken,
  }]));

  const intoNews = events.length
    ? new Set(trades.filter((t) => newsWindow(t.openedAt, events).event !== null).map((t) => t.id))
    : undefined;

  const closures = closuresIn(hourly);
  const nearClose = closures.length
    ? new Set(trades.filter((t) => {
        const s = sessionLeftAt(Math.floor(t.openedAt.getTime() / 1000), closures);
        return s !== null && s.minutesLeft < 15;
      }).map((t) => t.id))
    : undefined;

  return findLeaks({
    trades, timeZone, annotations: byHash, intoNews, nearClose,
    label: { feeling: feelingLabel, mistake: mistakeLabel, setup: (k) => k },
  }, limit);
}

function mostTraded(trades: ZoneTrade[]): string {
  const n = new Map<string, number>();
  for (const t of trades) n.set(t.symbol, (n.get(t.symbol) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
