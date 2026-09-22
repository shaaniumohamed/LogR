import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { importBatches, positions, zoneTrades } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { clusterPositions } from "@/lib/core/cluster";
import { tradesTag } from "@/lib/queries";
import type { Position } from "@/lib/core/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ingest already-parsed rows.
 *
 * The CSV is parsed IN THE BROWSER and only normalised JSON arrives here, which
 * sidesteps the serverless body-size and duration limits entirely — a 7-month
 * export is trivial for DOMParser and awkward for a 4.5MB request body.
 */
const PositionIn = z.object({
  ticket: z.string().min(1),
  openedAt: z.string(),
  closedAt: z.string(),
  direction: z.enum(["long", "short"]),
  symbol: z.string().min(1),
  lots: z.number().positive(),
  openPrice: z.number(),
  closePrice: z.number(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  commission: z.number(),
  swap: z.number(),
  profit: z.number(),
  closeReason: z.enum(["user", "tp", "sl", "so", "unknown"]),
});

const Body = z.object({
  filename: z.string().optional(),
  reportedNet: z.number().optional(),
  positions: z.array(PositionIn).min(1).max(20000),
});

export async function POST(req: Request) {
  // The ACTIVE account. A trader with a live account and a demo importing a
  // statement must have it land in the one they are looking at, and the old
  // helper returned whichever row the database offered first.
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { userId, account } = ctx;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed import payload" }, { status: 400 });
  }
  const { filename, reportedNet, positions: rows } = parsed.data;

  const [batch] = await db.insert(importBatches).values({
    userId, accountId: account.id, filename, rowsParsed: rows.length, reportedNet,
  }).returning();

  // Idempotent on (accountId, ticket, closedAt). Ticket alone is NOT unique:
  // partial exits of one position repeat it, and keying on it drops real trades.
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((p) => ({
      accountId: account.id,
      userId,
      ticket: p.ticket,
      openedAt: new Date(p.openedAt),
      closedAt: new Date(p.closedAt),
      direction: p.direction,
      symbol: p.symbol,
      lots: p.lots,
      openPrice: p.openPrice,
      closePrice: p.closePrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      commission: p.commission,
      swap: p.swap,
      profit: p.profit,
      closeReason: p.closeReason,
      importBatchId: batch.id,
    }));
    const res = await db.insert(positions).values(slice).onConflictDoNothing({
      target: [positions.accountId, positions.ticket, positions.closedAt],
    }).returning({ id: positions.id });
    inserted += res.length;
  }

  // Rebuild the derived layer from everything we now hold. Derived rows are
  // disposable by design; user annotations key to identityHash and are untouched.
  const all = await db.select().from(positions).where(eq(positions.accountId, account.id));
  const domain: Position[] = all.map((p) => ({
    ticket: p.ticket,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    direction: p.direction as "long" | "short",
    symbol: p.symbol,
    lots: p.lots,
    openPrice: p.openPrice,
    closePrice: p.closePrice,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    commission: p.commission,
    swap: p.swap,
    profit: p.profit,
    closeReason: p.closeReason as Position["closeReason"],
  }));
  const zones = clusterPositions(domain);

  await db.delete(zoneTrades).where(eq(zoneTrades.accountId, account.id));
  for (let i = 0; i < zones.length; i += CHUNK) {
    await db.insert(zoneTrades).values(
      zones.slice(i, i + CHUNK).map((z) => ({
        accountId: account.id,
        userId,
        identityHash: z.id,
        symbol: z.symbol,
        direction: z.direction,
        openedAt: z.openedAt,
        closedAt: z.closedAt,
        holdMinutes: z.holdMinutes,
        legCount: z.legCount,
        exitCount: z.exitCount,
        lots: z.lots,
        avgEntry: z.avgEntry,
        avgExit: z.avgExit,
        zoneLow: z.zoneLow,
        zoneHigh: z.zoneHigh,
        netPnl: z.netPnl,
        hadStop: z.hadStop,
        closeReasons: z.closeReasons,
      }))
    ).onConflictDoNothing();
  }

  await db.update(importBatches)
    .set({ rowsInserted: inserted, rowsDuplicate: rows.length - inserted })
    .where(and(eq(importBatches.id, batch.id), eq(importBatches.userId, userId)));

  // The trade list is cached between requests so a page load is not a round
  // trip to another continent. An import is the only thing that changes it, so
  // it is also the only thing that has to clear it — and it must, or the reader
  // would drop a file in and watch nothing happen.
  // `expire: 0` rather than a named profile: an import must be visible on the
  // very next page load, not eventually.
  revalidateTag(tradesTag(account.id), { expire: 0 });

  return NextResponse.json({
    ok: true,
    inserted,
    duplicates: rows.length - inserted,
    totalPositions: all.length,
    zoneTrades: zones.length,
  });
}
