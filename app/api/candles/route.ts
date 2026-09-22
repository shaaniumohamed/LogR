import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requestContext } from "@/lib/session";
import { priceBars } from "@/lib/db/schema";
import { normalizeSymbol } from "@/lib/candles";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Bars arrive as tuples, not objects.
 *
 * `[1758205800, 4350.1, 4351.2, 4349.8, 4350.9]` is about a third the bytes of
 * the same row with keys, and a month of one-minute gold is 30,000 rows. That
 * difference is what keeps an import inside a serverless request body instead of
 * needing a file upload service.
 */
const Bar = z.tuple([z.number().int(), z.number(), z.number(), z.number(), z.number()]);

const Body = z.object({
  symbol: z.string().min(1).max(20),
  source: z.string().max(40).optional(),
  bars: z.array(Bar).min(1).max(20000),
});

export async function POST(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed candle payload" }, { status: 400 });

  const symbol = normalizeSymbol(parsed.data.symbol);
  const source = parsed.data.source ?? "csv";

  const rows = parsed.data.bars.map(([t, open, high, low, close]) => ({
    symbol,
    // Snapped to the minute so a source with stray seconds cannot create two
    // rows for one bar, which would break both the primary key's job and rollup.
    t: new Date(Math.floor(t / 60) * 60_000),
    open, high, low, close, source,
  }));

  /*
   * Upsert rather than skip-on-conflict. A re-import is nearly always a
   * correction — a better source, or the same file read in the right zone — and
   * silently keeping the first version would make the fix look like it worked
   * while changing nothing on the chart.
   */
  let written = 0;
  const CHUNK = 2000; // 2000 rows × 6 columns stays well inside Postgres' parameter limit
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db.insert(priceBars).values(slice).onConflictDoUpdate({
      target: [priceBars.symbol, priceBars.t],
      // `excluded` is the row that lost the conflict — i.e. the incoming one.
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`,
        low: sql`excluded.low`, close: sql`excluded.close`, source: sql`excluded.source`,
      },
    });
    written += slice.length;
  }

  return NextResponse.json({ ok: true, written, symbol });
}

/**
 * Clear price history, so a bad import can be undone rather than lived with.
 *
 * OWNERS ONLY, and that restriction is about the sharing rather than about
 * trust. Price bars are deliberately common to everyone here — a gold candle at
 * 14:32 is the same candle for every account, and one person importing a month
 * covers the rest. The flip side is that one person deleting a year takes it
 * from everybody, and every other button in this app can only affect the person
 * pressing it. Adding candles stays open, because adding is correctable and
 * has to pass the alignment check against the importer's own fills.
 */
export async function DELETE(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!ctx.isOwner) {
    return NextResponse.json({
      error: "Only an owner can delete price history.",
      detail: "Candles are shared by everyone using this journal, so removing them would remove them for everybody. Ask whoever runs it.",
    }, { status: 403 });
  }

  const url = new URL(req.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ error: "Which symbol?" }, { status: 400 });

  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  const where = from && to
    ? and(eq(priceBars.symbol, symbol), between(priceBars.t, new Date(from), new Date(to)))
    : eq(priceBars.symbol, symbol);

  const removed = await db.delete(priceBars).where(where).returning({ t: priceBars.t });
  return NextResponse.json({ ok: true, removed: removed.length });
}
