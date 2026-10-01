import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { and, between, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { importBatches, positions, tradingAccounts, zoneTrades } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { rebuildZoneTrades } from "@/lib/derive";
import { accountNumberFromFilename, detectMismatch, sampleTickets } from "@/lib/core/import-guard";
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
  /** The account number the file carries, when it carries one. */
  accountNumber: z.string().optional(),
  /** Set only after the reader has been shown a mismatch and chosen to go on. */
  confirm: z.boolean().optional(),
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
  const { filename, reportedNet, accountNumber, confirm, positions: rows } = parsed.data;

  /*
   * Is this file even this account's?
   *
   * Checked HERE rather than in the browser, and not only because a stale page
   * could skip it: the answer needs the stored history, and the browser has
   * none of it.
   *
   * The account number decides when both sides have one. Otherwise the tickets
   * do: a file covering dates this account already holds, sharing not one
   * ticket with them, is not this account's record of those dates. Only a
   * sample of tickets is sent to the database — a year of this trader's fills
   * is tens of thousands, and four hundred of them answer the question just as
   * well as all of them.
   */
  const fileLogin = accountNumber?.trim() || accountNumberFromFilename(filename ?? "") || null;
  const span = rows.reduce(
    (a, p) => ({
      from: !a.from || p.openedAt < a.from ? p.openedAt : a.from,
      to: !a.to || p.closedAt > a.to ? p.closedAt : a.to,
    }),
    { from: "", to: "" } as { from: string; to: string },
  );

  const [[existing], [matching]] = await Promise.all([
    db.select({ n: count() }).from(positions).where(and(
      eq(positions.accountId, account.id),
      between(positions.closedAt, new Date(span.from), new Date(span.to)),
    )),
    db.select({ n: count() }).from(positions).where(and(
      eq(positions.accountId, account.id),
      inArray(positions.ticket, sampleTickets(rows.map((r) => r.ticket))),
    )),
  ]);

  const mismatch = detectMismatch({
    storedLogin: account.login,
    fileLogin,
    existingInSpan: Number(existing.n),
    matchingTickets: Number(matching.n),
  });

  if (mismatch && !confirm) {
    return NextResponse.json({
      error: mismatch.kind === "login"
        ? `This file is from account ${mismatch.found}, and “${account.nickname}” is account ${mismatch.stored}.`
        : `This file covers dates “${account.nickname}” already has, but none of its trades are ones this account made.`,
      reason: mismatch.kind,
      detail: mismatch.kind === "login"
        ? "Switch to the right journal, or add a new one for this account, before importing."
        : "That usually means it is an export from a different account. Importing it would mix two accounts into one set of numbers.",
    }, { status: 409 });
  }

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

  // Rebuild the derived layer from everything we now hold. Shared with the undo
  // path, so taking an import back produces exactly what never importing it would.
  const { positions: totalPositions, zoneTrades: zoneCount } = await rebuildZoneTrades(account.id, userId);

  await db.update(importBatches)
    .set({ rowsInserted: inserted, rowsDuplicate: rows.length - inserted })
    .where(and(eq(importBatches.id, batch.id), eq(importBatches.userId, userId)));

  // The trade list is cached between requests so a page load is not a round
  // trip to another continent. An import is the only thing that changes it, so
  // it is also the only thing that has to clear it — and it must, or the reader
  // would drop a file in and watch nothing happen.
  // `expire: 0` rather than a named profile: an import must be visible on the
  // very next page load, not eventually.
  // Learnt once, so the next import can be checked against it rather than
  // inferred from tickets. Only ever filled in, never overwritten: the stored
  // number is what the mismatch check trusts.
  if (fileLogin && !account.login) {
    await db.update(tradingAccounts)
      .set({ login: fileLogin })
      .where(and(eq(tradingAccounts.id, account.id), eq(tradingAccounts.userId, userId)));
  }

  revalidateTag(tradesTag(account.id), { expire: 0 });

  return NextResponse.json({
    ok: true,
    inserted,
    duplicates: rows.length - inserted,
    totalPositions,
    zoneTrades: zoneCount,
  });
}
