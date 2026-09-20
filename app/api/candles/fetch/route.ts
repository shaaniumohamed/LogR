import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { positions, priceBars } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";
import { normalizeSymbol } from "@/lib/core/symbols";
import { checkAlignment } from "@/lib/core/parse-candles";
import { ProviderError, RATE, buildUrl, normalise } from "@/lib/core/provider-twelvedata";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  symbol: z.string().min(1).max(20),
  from: z.string(),
  to: z.string(),
});

/** One call returns at most 5000 one-minute bars, so the window is capped to match. */
const MAX_MINUTES = RATE.maxBars;

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "No price service key is configured.",
      hint: "Get a free key at twelvedata.com, then add TWELVEDATA_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
    }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed request" }, { status: 400 });

  const symbol = normalizeSymbol(parsed.data.symbol);
  const from = new Date(parsed.data.from);
  let to = new Date(parsed.data.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return NextResponse.json({ error: "That is not a valid date range" }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_MINUTES * 60_000) {
    to = new Date(from.getTime() + MAX_MINUTES * 60_000);
  }

  /* ------------------------------------------------------------- fetch */
  let candles;
  try {
    // The URL carries the API key, so it must never reach a log or a response.
    const res = await fetch(buildUrl({ symbol, from, to, apiKey }), {
      signal: AbortSignal.timeout(25_000),
      headers: { accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    candles = normalise(body);
  } catch (e) {
    if (e instanceof ProviderError) {
      // 429 is the one the trader will actually meet, and it is not a fault.
      return NextResponse.json({ error: e.message, code: e.code },
        { status: e.code === 429 ? 429 : 502 });
    }
    return NextResponse.json(
      { error: "Could not reach the price service. Try again in a moment." }, { status: 502 });
  }

  /* --------------------------------------------------------- verify first */
  /*
   * Same rule as the file import: candles that do not line up with this
   * trader's own fills do not get stored. A provider can answer in the wrong
   * zone, or hand back a different instrument under a similar ticker, and
   * neither failure looks like anything on a chart — the only thing that can
   * tell is a price the trader is known to have transacted at.
   */
  const account = await getOrCreateAccount(userId);
  const pad = 86_400_000;
  const lo = new Date(from.getTime() - pad), hi = new Date(to.getTime() + pad);
  const [opens, closes] = await Promise.all([
    db.select({ t: positions.openedAt, p: positions.openPrice }).from(positions)
      .where(and(eq(positions.accountId, account.id), between(positions.openedAt, lo, hi))),
    db.select({ t: positions.closedAt, p: positions.closePrice }).from(positions)
      .where(and(eq(positions.accountId, account.id), between(positions.closedAt, lo, hi))),
  ]);
  const alignment = checkAlignment(
    candles,
    [...opens, ...closes].map((r) => ({ time: Math.floor(r.t.getTime() / 1000), price: r.p })),
  );

  if (alignment.checked > 0 && (alignment.score ?? 0) < 0.9) {
    return NextResponse.json({
      error: "The candles that came back do not match your fills, so they were not saved.",
      detail: `${Math.round((alignment.score ?? 0) * 100)}% of your ${alignment.checked} fills in that period landed inside their own candle.`
        + (alignment.bestShiftMinutes !== 0 && (alignment.bestScore ?? 0) >= 0.9
          ? ` They would match shifted by ${alignment.bestShiftMinutes / 60} hours, which means the service answered in the wrong time zone.`
          : " This is most likely a different instrument under a similar ticker."),
      alignment,
    }, { status: 409 });
  }

  /* -------------------------------------------------------------- store */
  const rows = candles.map((c) => ({
    symbol,
    t: new Date(Math.floor(c.time / 60) * 60_000),
    open: c.open, high: c.high, low: c.low, close: c.close,
    source: "twelvedata",
  }));

  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(priceBars).values(rows.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [priceBars.symbol, priceBars.t],
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`,
        low: sql`excluded.low`, close: sql`excluded.close`, source: sql`excluded.source`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    stored: rows.length,
    symbol,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    alignment,
  });
}
