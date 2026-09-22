import { and, asc, between, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { economicEvents } from "@/lib/db/schema";
import { readOrDegrade } from "@/lib/db/schema-check";
import type { Impact, NewsEvent } from "@/lib/core/news";

/** Releases in a window, oldest first — the order newsWindow expects. */
export async function loadEvents(from: Date, to: Date): Promise<NewsEvent[]> {
  return readOrDegrade(async () => {
    const rows = await db.select().from(economicEvents)
      .where(between(economicEvents.at, from, to))
      .orderBy(asc(economicEvents.at));
    return rows.map((r) => ({
      at: r.at, currency: r.currency, title: r.title,
      impact: r.impact as Impact, source: r.source,
    }));
  }, []);
}

export interface EventCoverage { events: number; high: number; from: Date | null; to: Date | null }

export async function eventCoverage(): Promise<EventCoverage> {
  return readOrDegrade(async () => {
    const [row] = await db.select({
      events: sql<number>`count(*)::int`,
      high: sql<number>`count(*) filter (where impact = 'high')::int`,
      from: sql<Date | null>`min(at)`,
      to: sql<Date | null>`max(at)`,
    }).from(economicEvents);
    return {
      events: row?.events ?? 0, high: row?.high ?? 0,
      from: row?.from ? new Date(row.from) : null,
      to: row?.to ? new Date(row.to) : null,
    };
  }, { events: 0, high: 0, from: null, to: null });
}

/**
 * Store events, ignoring the ones already held.
 *
 * `onConflictDoNothing` rather than an update, because the identity of a row
 * here IS its whole content bar the impact and the source — so a conflict means
 * the same release, and the version already stored is as good as the new one.
 */
export async function saveEvents(events: NewsEvent[]): Promise<number> {
  if (!events.length) return 0;
  const rows = events.map((e) => ({
    at: e.at, currency: e.currency.slice(0, 8), title: e.title.slice(0, 140),
    impact: e.impact, source: e.source,
  }));

  let stored = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await db.insert(economicEvents).values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ at: economicEvents.at });
    stored += res.length;
  }
  return stored;
}

/** Remove everything derived, so a re-derivation cannot leave stale rows behind. */
export async function clearDerived(): Promise<void> {
  await db.delete(economicEvents).where(and(eq(economicEvents.source, "derived")));
}
