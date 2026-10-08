import { NextResponse } from "next/server";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { marketChunks } from "@/lib/db/schema";
import { ownerGate } from "@/lib/market-data";
import { deleteObject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{3,12}$/),
  /** One UTC year. Omit to remove the symbol entirely. */
  year: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * Remove price history, for a bad import or a symbol no longer wanted.
 *
 * By whole year or whole symbol, never by day. A year is the unit every file
 * kind lines up on — its tick days, its twelve M1 months, its H1 and D1 files —
 * so removing a year leaves nothing behind that describes days that are gone.
 * Removing three days would leave month and year candles drawn from ticks that
 * no longer exist.
 */
export async function POST(req: Request) {
  const gate = await ownerGate();
  if (gate.error) return gate.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { symbol, year } = parsed.data;

  const rows = await db.delete(marketChunks).where(and(
    eq(marketChunks.symbol, symbol),
    year ? like(marketChunks.period, `${year}%`) : undefined,
  )).returning({ key: marketChunks.key });
  for (let i = 0; i < rows.length; i += 16) await Promise.all(rows.slice(i, i + 16).map((r) => deleteObject(r.key)));
  return NextResponse.json({ ok: true, removed: rows.length });
}
