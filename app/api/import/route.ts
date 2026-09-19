import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { importBatches, positions, zoneTrades } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";
import { clusterPositions } from "@/lib/core/cluster";
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
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed import payload" }, { status: 400 });
  }
  const { filename, reportedNet, positions: rows } = parsed.data;
  const account = await getOrCreateAccount(userId);

  const [batch] = await db.insert(importBatches).values({
    userId, accountId: account.id, filename, rowsParsed: rows.length, reportedNet,
  }).returning();

  // Idempotent on (accountId, ticket): re-importing an overlapping export adds
  // nothing and duplicates nothing, so the user can re-upload without fear.
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
      target: [positions.accountId, positions.ticket],
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

  return NextResponse.json({
    ok: true,
    inserted,
    duplicates: rows.length - inserted,
    totalPositions: all.length,
    zoneTrades: zones.length,
  });
}
