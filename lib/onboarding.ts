import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { readOrDegrade } from "@/lib/db/schema-check";

export interface SetupState {
  hasTrades: boolean;
  hasPrices: boolean;
  hasReviewed: boolean;
  /** Nothing left to show, so nothing is shown. */
  done: boolean;
}

/**
 * How far through setting up this account is.
 *
 * Three existence checks in ONE statement, and `exists` rather than `count`:
 * the question is whether there is any at all, and counting price bars would
 * walk a table with millions of rows to answer something the first row settles.
 *
 * There is no "dismissed" flag anywhere, on purpose. A checklist that has to be
 * dismissed is a checklist that comes back on the next device, or sticks around
 * after the work is done because the flag and the facts disagree. This one is
 * derived from whether the work actually happened, so it disappears by itself
 * and cannot be wrong.
 */
export const setupState = cache(async (accountId: string): Promise<SetupState> =>
  readOrDegrade(async () => {
    const rows = await db.execute<{ trades: boolean; prices: boolean; reviewed: boolean }>(sql`
      select
        exists (select 1 from "zone_trade" where "account_id" = ${accountId}) as trades,
        exists (select 1 from "price_bar") as prices,
        exists (
          select 1 from "trade_annotation"
          where "account_id" = ${accountId}
            and (coalesce("note", '') <> '' or "setup" is not null or "emotion" is not null)
        ) as reviewed
    `);
    // node-postgres hands back { rows }, the Neon HTTP driver the array itself.
    const r = (Array.isArray(rows) ? rows[0] : rows.rows[0]) as
      { trades: boolean; prices: boolean; reviewed: boolean } | undefined;

    const state = {
      hasTrades: !!r?.trades,
      hasPrices: !!r?.prices,
      hasReviewed: !!r?.reviewed,
    };
    return { ...state, done: state.hasTrades && state.hasPrices && state.hasReviewed };
  }, { hasTrades: true, hasPrices: true, hasReviewed: true, done: true })
);
