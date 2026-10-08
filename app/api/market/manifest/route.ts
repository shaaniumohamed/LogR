import { NextResponse } from "next/server";
import { listChunks, readerGate } from "@/lib/market-data";
import { viewUrl } from "@/lib/storage";
import { RESOLUTIONS, isPeriod, type Resolution } from "@/lib/core/market/periods";

export const runtime = "nodejs";

/** Enough for two months of tick days or a decade of yearly files in one call. */
const MAX_ROWS = 400;

/**
 * Which files exist for a symbol and resolution, each with a link to download
 * it for the next hour. Readable by anyone with access — prices are shared —
 * and the links expire, so a copied one stops working.
 */
export async function GET(req: Request) {
  const gate = await readerGate();
  if (gate.error) return gate.error;

  const q = new URL(req.url).searchParams;
  const symbol = (q.get("symbol") ?? "").toUpperCase();
  const resolution = q.get("resolution") as Resolution;
  const from = q.get("from") ?? undefined;
  const to = q.get("to") ?? undefined;
  if (!/^[A-Z0-9]{3,12}$/.test(symbol) || !RESOLUTIONS.includes(resolution)
      || (from && !isPeriod(resolution, from)) || (to && !isPeriod(resolution, to))) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const rows = await listChunks(symbol, resolution, from, to);
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: "Ask for a shorter range." }, { status: 413 });

  return NextResponse.json({
    chunks: rows.map((r) => ({
      period: r.period, sha256: r.sha256, rows: r.rows, bytes: r.bytes,
      firstAt: Math.floor(r.firstAt.getTime() / 1000), lastAt: Math.floor(r.lastAt.getTime() / 1000),
      sourceSymbol: r.sourceSymbol, url: viewUrl(r.key),
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
