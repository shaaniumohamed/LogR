/**
 * How much chart to show around a trade.
 *
 * Context is what makes a review chart worth looking at — a five-minute scalp
 * drawn on six minutes of bars tells you nothing about where price came from,
 * which is the whole question when the setup was a level. But a fixed window is
 * wrong at both ends: four hours is generous around a scalp and invisible around
 * a two-day swing.
 *
 * So the window scales with the trade and then stops. Three times the hold on
 * each side, never less than three hours (enough to see the session build), never
 * more than a day and a half (beyond which M1 stops being the right resolution
 * and the payload stops being small).
 */
export function contextWindow(openedAt: Date, closedAt: Date) {
  const holdMs = Math.max(60_000, closedAt.getTime() - openedAt.getTime());
  const pad = Math.min(Math.max(holdMs * 3, 3 * 3600_000), 36 * 3600_000);
  return { from: new Date(openedAt.getTime() - pad), to: new Date(closedAt.getTime() + pad) };
}

/**
 * The window to ASK the price service for, as opposed to the window to draw.
 *
 * Rounded out to whole UTC days, because a call costs the same whether it
 * returns three hours or a whole session and this trader takes around a hundred
 * orders a day: fetching the day rather than the trade turns a hundred calls
 * into one, and the free plan allows eight a minute.
 *
 * Capped at three days so a single response always stays inside the provider's
 * 5000-bar limit.
 */
export function fetchWindow(openedAt: Date, closedAt: Date) {
  const { from, to } = contextWindow(openedAt, closedAt);
  const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = dayStart(from);
  let end = new Date(dayStart(to).getTime() + 86_400_000 - 60_000);
  const maxEnd = start.getTime() + 3 * 86_400_000 - 60_000;
  if (end.getTime() > maxEnd) end = new Date(maxEnd);
  return { from: start, to: end };
}

export interface FillCoverage {
  /** Fills that have a candle at, or within a minute or two of, their own minute. */
  covered: number;
  total: number;
  /** True when every fill can be seen on the chart. */
  complete: boolean;
}

/**
 * How much of this trade the candles we hold can actually show.
 *
 * Asked because "there are some bars" is not the same as "the chart is usable".
 * A fetch that half-filled a day, a provider that publishes nothing through a
 * thin minute, a trade that started before the window we happened to pull — all
 * three leave a chart that draws perfectly well and simply does not contain the
 * entry. Counting fills rather than minutes makes the answer something a trader
 * can act on: three of your eleven fills are not on this chart.
 *
 * `slackMinutes` exists because a bar is missing in two different senses. A gap
 * of one minute in a feed is normal and costs nothing — the fill still sits in
 * the picture. A gap of hours is the day never having been fetched.
 */
export function coversFills(
  bars: { time: number }[],
  fills: { time: number }[],
  slackMinutes = 2,
): FillCoverage {
  if (!fills.length) return { covered: 0, total: 0, complete: true };
  if (!bars.length) return { covered: 0, total: fills.length, complete: false };

  const minutes = new Set(bars.map((b) => Math.floor(b.time / 60)));
  let covered = 0;
  for (const f of fills) {
    const m = Math.floor(f.time / 60);
    for (let d = -slackMinutes; d <= slackMinutes; d++) {
      if (minutes.has(m + d)) { covered++; break; }
    }
  }
  return { covered, total: fills.length, complete: covered === fills.length };
}
