import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  positions, tradeAnnotations, tradeScreenshots, tradingRules, weeklyNotes, zoneTrades,
} from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { isoSecond, toCsv, type Column } from "@/lib/core/csv";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Everything this account holds, in a file the trader keeps.
 *
 * The cheapest insurance there is. A journal is worth something precisely
 * because it accumulates — a year of notes about why each trade was taken is
 * not reconstructible — and it currently lives in one database behind one
 * login. Anyone should be able to walk away with the lot at any moment, and
 * knowing they can is most of what makes it safe to put the year in.
 *
 * Two shapes, because there are two reasons to ask. The CSV is one row per
 * trade with the notes flattened alongside, which is what a spreadsheet, a
 * coach or a statistics package wants. The JSON is the whole graph, which is
 * what a restore or a move to something else would need.
 *
 * Price history is deliberately absent from both: it is public market data
 * shared by every account here, it is by far the largest thing in the
 * database, and none of it is the trader's.
 */
export async function GET(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const accountId = ctx.account.id;

  const [trades, fills, notes, rules, weeks, shots] = await Promise.all([
    db.select().from(zoneTrades).where(eq(zoneTrades.accountId, accountId)).orderBy(asc(zoneTrades.closedAt)),
    db.select().from(positions).where(eq(positions.accountId, accountId)).orderBy(asc(positions.closedAt)),
    db.select().from(tradeAnnotations).where(eq(tradeAnnotations.accountId, accountId)),
    db.select().from(tradingRules).where(eq(tradingRules.accountId, accountId)),
    db.select().from(weeklyNotes).where(eq(weeklyNotes.accountId, accountId)).orderBy(asc(weeklyNotes.weekStart)),
    db.select().from(tradeScreenshots).where(eq(tradeScreenshots.accountId, accountId)),
  ]);

  const day = new Date().toISOString().slice(0, 10);
  const safeName = ctx.account.nickname.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "account";
  const filename = `logr-${safeName}-${day}.${format}`;

  if (format === "json") {
    const body = {
      exportedAt: new Date().toISOString(),
      // The format's own version, so a future importer can tell what it is
      // looking at without guessing from the shape.
      schema: 1,
      account: {
        nickname: ctx.account.nickname, broker: ctx.account.broker,
        currency: ctx.account.currency, kind: ctx.account.accountKind,
      },
      counts: {
        trades: trades.length, fills: fills.length, notes: notes.length,
        rules: rules.length, weeklyNotes: weeks.length, screenshots: shots.length,
      },
      trades, fills, annotations: notes, rules, weeklyNotes: weeks,
      // Keys only: the images themselves live in object storage, and a link to
      // one expires within the hour by design.
      screenshots: shots.map((s) => ({
        identityHash: s.identityHash, storageKey: s.storageKey,
        contentType: s.contentType, bytes: s.bytes, caption: s.caption,
        createdAt: s.createdAt,
      })),
      note: "Price history is not included: it is shared public market data, not yours.",
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const noteFor = new Map(notes.map((a) => [a.identityHash, a]));
  const ruleText = new Map(rules.map((r) => [r.id, r.text]));
  const shotCount = new Map<string, number>();
  for (const s of shots) shotCount.set(s.identityHash, (shotCount.get(s.identityHash) ?? 0) + 1);

  type Row = (typeof trades)[number];
  const columns: Column<Row>[] = [
    { key: "id", label: "Trade id", value: (t) => t.identityHash },
    { key: "symbol", label: "Symbol", value: (t) => t.symbol },
    { key: "direction", label: "Direction", value: (t) => (t.direction === "long" ? "Buy" : "Sell") },
    { key: "opened", label: "Opened (UTC)", value: (t) => isoSecond(t.openedAt) },
    { key: "closed", label: "Closed (UTC)", value: (t) => isoSecond(t.closedAt) },
    { key: "hold", label: "Held (minutes)", value: (t) => t.holdMinutes },
    { key: "lots", label: "Lots", value: (t) => t.lots },
    { key: "entries", label: "Entries", value: (t) => t.legCount },
    { key: "exits", label: "Exits", value: (t) => t.exitCount },
    { key: "avgEntry", label: "Average entry", value: (t) => t.avgEntry },
    { key: "avgExit", label: "Average exit", value: (t) => t.avgExit },
    { key: "zoneLow", label: "Zone low", value: (t) => t.zoneLow },
    { key: "zoneHigh", label: "Zone high", value: (t) => t.zoneHigh },
    { key: "net", label: "Net result", value: (t) => t.netPnl },
    { key: "hadStop", label: "Had a stop", value: (t) => (t.hadStop ? "yes" : "no") },
    { key: "endings", label: "How it ended", value: (t) => t.closeReasons.join(" ") },
    { key: "setup", label: "Setup", value: (t) => noteFor.get(t.identityHash)?.setup },
    { key: "timeframe", label: "Timeframe read on", value: (t) => noteFor.get(t.identityHash)?.timeframe },
    { key: "invalidation", label: "Invalidation", value: (t) => noteFor.get(t.identityHash)?.invalidation },
    { key: "emotion", label: "How you felt", value: (t) => noteFor.get(t.identityHash)?.emotion },
    { key: "confluences", label: "Confluences", value: (t) => noteFor.get(t.identityHash)?.confluences?.join(" ") },
    { key: "mistakes", label: "Mistakes", value: (t) => noteFor.get(t.identityHash)?.mistakes?.join(" ") },
    {
      key: "rulesBroken", label: "Rules broken",
      // Written out in words, because a column of opaque ids helps nobody
      // opening this in a spreadsheet six months from now.
      value: (t) => (noteFor.get(t.identityHash)?.rulesBroken ?? [])
        .map((id) => ruleText.get(id) ?? id).join(" | "),
    },
    { key: "note", label: "Note", value: (t) => noteFor.get(t.identityHash)?.note },
    { key: "screenshots", label: "Screenshots", value: (t) => shotCount.get(t.identityHash) ?? 0 },
  ];

  return new NextResponse(toCsv(trades, columns), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
