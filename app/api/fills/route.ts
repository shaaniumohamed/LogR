import { NextResponse } from "next/server";
import { and, between, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Every price this trader actually transacted at, inside a date range.
 *
 * Exists for one job: proving an uploaded candle file lines up before it is
 * saved. A fill happened at a price the market was really trading, so it has to
 * sit inside the high–low of the minute it happened in — which makes the
 * trader's own history the only ground truth needed to catch a file written in
 * the wrong time zone (see checkAlignment in lib/core/parse-candles.ts).
 *
 * Returned as [seconds, price] tuples: thousands of them travel in a few tens of
 * kilobytes, and the client only ever iterates them.
 */
export async function GET(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? "");
  const to = new Date(url.searchParams.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Need a from and a to" }, { status: 400 });
  }

  const account = ctx.account;
  // Opens and closes are checked separately because they are separate moments;
  // a position opened inside the range but closed outside it still proves an
  // entry price, so the two are queried independently rather than as one span.
  const [opens, closes] = await Promise.all([
    db.select({ t: positions.openedAt, p: positions.openPrice }).from(positions)
      .where(and(eq(positions.accountId, account.id), between(positions.openedAt, from, to))),
    db.select({ t: positions.closedAt, p: positions.closePrice }).from(positions)
      .where(and(eq(positions.accountId, account.id), between(positions.closedAt, from, to))),
  ]);

  const fills = [...opens, ...closes].map((r) => [Math.floor(r.t.getTime() / 1000), r.p]);
  return NextResponse.json({ fills });
}
