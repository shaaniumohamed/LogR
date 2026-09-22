import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "./index";

/**
 * Is this failure the database being older than the code?
 *
 * Postgres answers a missing table with SQLSTATE 42P01 and a missing column
 * with 42703. Both mean the same thing here: someone deployed new code without
 * running the migration. The message is matched as well as the code, because
 * the serverless driver does not promise to carry SQLSTATE through on every
 * path and being wrong in that direction would swallow a real error.
 */
export function isSchemaBehind(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "42P01" || err?.code === "42703") return true;
  return /relation .+ does not exist|column .+ does not exist/i.test(err?.message ?? "");
}

/**
 * Run a read that might outrun the database, and degrade instead of failing.
 *
 * A journal whose Patterns page returns a 500 with an opaque digest — because
 * one column it does not even need yet is absent — is worse than one that shows
 * the trades and says what to run. Only READS use this. A write that silently
 * did nothing would be far worse than a write that errors.
 */
export async function readOrDegrade<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (isSchemaBehind(e)) return fallback;
    throw e;
  }
}

/**
 * Cached on the way up only.
 *
 * Once the migration has run the answer cannot go back to false, so a positive
 * result is worth keeping for the life of the instance. A negative one is
 * re-probed, so the banner disappears on the next request after the fix rather
 * than waiting for a cold start.
 */
let current = false;

/**
 * The two probes run together rather than one after the other. Each is a
 * separate crossing to the database and neither depends on the other, so
 * serialising them doubled the delay in front of every single page for no
 * reason at all.
 */
export const schemaIsCurrent = cache(async (): Promise<boolean> => {
  if (current) return true;
  try {
    await Promise.all([
      db.execute(sql`select "drawings" from "trade_annotation" limit 0`),
      db.execute(sql`select 1 from "price_bar" limit 0`),
      db.execute(sql`select 1 from "price_bar_htf" limit 0`),
      db.execute(sql`select 1 from "trade_screenshot" limit 0`),
      db.execute(sql`select 1 from "invite" limit 0`),
      db.execute(sql`select 1 from "trading_rule" limit 0`),
      db.execute(sql`select 1 from "economic_event" limit 0`),
    ]);
    current = true;
  } catch {
    return false;
  }
  return true;
});
