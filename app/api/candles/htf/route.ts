import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceBarsHtf } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { normalizeSymbol } from "@/lib/core/symbols";
import { HIGHER_TIMEFRAMES, checkBarAlignment, higherTimeframe } from "@/lib/core/timeframes";
import { ProviderError, authHeaders, buildUrl, normalise } from "@/lib/core/provider-twelvedata";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  symbol: z.string().min(1).max(20),
  /** One interval per call, so the client can pace itself and report progress. */
  tf: z.string().min(1).max(10),
});

/**
 * Fetch one higher timeframe for one symbol, for the whole history the provider
 * will give.
 *
 * Separate from the per-day one-minute route because the economics are
 * completely different. A minute backfill is one call per trading day and a
 * hundred and fifty days of history costs a hundred and fifty calls. A single
 * call at four hours returns two years, and at a day returns thirteen — so four
 * calls in total give every trade in the account its higher-timeframe context,
 * for good, against an allowance of eight hundred a day.
 *
 * That is why this asks for no date range. Naming one would be arithmetic with
 * nothing gained: the provider returns its most recent five thousand bars and
 * five thousand bars at these intervals already outruns any retail history.
 */
export async function POST(req: Request) {
  const ctx = await requestContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

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
  const tf = higherTimeframe(parsed.data.tf);
  if (!tf) {
    return NextResponse.json({
      error: `Unknown timeframe. Expected one of ${HIGHER_TIMEFRAMES.map((t) => t.key).join(", ")}.`,
    }, { status: 400 });
  }

  /* ------------------------------------------------------------- fetch */
  let candles;
  try {
    const res = await fetch(buildUrl({ symbol, interval: tf.key }), {
      signal: AbortSignal.timeout(25_000),
      headers: authHeaders(apiKey),
    });
    const body = await res.json().catch(() => null);
    candles = normalise(body);
  } catch (e) {
    if (e instanceof ProviderError) {
      return NextResponse.json({ error: e.message, code: e.code },
        { status: e.code === 429 ? 429 : 502 });
    }
    return NextResponse.json(
      { error: "Could not reach the price service. Try again in a moment." }, { status: 502 });
  }

  /* --------------------------------------------------------- verify first */
  /*
   * A weaker check than the one-minute path uses, honestly labelled.
   *
   * A fill must sit inside the high and low of its own MINUTE, and that single
   * question catches a wrong timezone, a wrong instrument and a daylight-saving
   * change at once. A daily range is far too wide to ask it of: almost any price
   * from the same market lands inside almost any day.
   *
   * What a daily bar can still answer is whether this is the same instrument at
   * the same scale, and that is the failure that actually happens here — a
   * similar ticker resolving to gold futures, or to a currency pair. Gold fills
   * do not land inside either. So the bar is set high and the question is
   * narrow, rather than pretending to a precision these candles do not have.
   */
  const first = new Date(candles[0].time * 1000);
  const last = new Date(candles[candles.length - 1].time * 1000);
  const [opens, closes] = await Promise.all([
    db.select({ t: positions.openedAt, p: positions.openPrice }).from(positions)
      .where(and(eq(positions.accountId, ctx.account.id), between(positions.openedAt, first, last))),
    db.select({ t: positions.closedAt, p: positions.closePrice }).from(positions)
      .where(and(eq(positions.accountId, ctx.account.id), between(positions.closedAt, first, last))),
  ]);
  const fills = [...opens, ...closes].map((r) => ({ time: Math.floor(r.t.getTime() / 1000), price: r.p }));
  const alignment = checkBarAlignment(candles, fills, tf.seconds);

  if (alignment.checked >= 20 && (alignment.lenientScore ?? 0) < 0.95) {
    return NextResponse.json({
      error: `Those ${tf.label} candles do not match your fills, so they were not saved.`,
      detail: `Only ${Math.round((alignment.lenientScore ?? 0) * 100)}% of the ${alignment.checked} fills they cover fall inside their own candle's range. A ${tf.label} range is wide enough to contain almost any price from the same market, so failing this check means a different instrument came back under a similar ticker.`,
      alignment,
    }, { status: 409 });
  }

  /* -------------------------------------------------------------- store */
  const rows = candles.map((c) => ({
    symbol, tf: tf.key, t: new Date(c.time * 1000),
    open: c.open, high: c.high, low: c.low, close: c.close,
    source: "twelvedata",
  }));

  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(priceBarsHtf).values(rows.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [priceBarsHtf.symbol, priceBarsHtf.tf, priceBarsHtf.t],
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`,
        low: sql`excluded.low`, close: sql`excluded.close`, source: sql`excluded.source`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    tf: tf.key,
    label: tf.label,
    stored: rows.length,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    alignment,
  });
}
