import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { marketChunks } from "@/lib/db/schema";
import { ChunkMeta, findChunk, ownerGate } from "@/lib/market-data";
import { StorageError, deleteObject, headObject } from "@/lib/storage";
import { chunkKey } from "@/lib/core/market/periods";

export const runtime = "nodejs";

/**
 * Step two: the file is in the bucket — record it.
 *
 * Nothing is taken on trust. The key must be the one this description maps to
 * (so a caller cannot point the catalogue at some other object), and the stored
 * object must exist at exactly the size claimed. Only then does the catalogue
 * switch to it, and only after that is a previous version of the same period
 * removed: a reader halfway through downloading the old file never finds it gone.
 */
export async function POST(req: Request) {
  const gate = await ownerGate();
  if (gate.error) return gate.error;

  const parsed = ChunkMeta.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That file description is not valid." }, { status: 400 });
  const m = parsed.data;
  const key = chunkKey(m.symbol, m.resolution, m.period, m.sha256);

  let stored: { size: number } | null;
  try {
    stored = await headObject(key);
  } catch (e) {
    return NextResponse.json({ error: e instanceof StorageError ? e.message : "Could not reach storage." }, { status: 502 });
  }
  if (!stored) return NextResponse.json({ error: "The upload is not in storage." }, { status: 409 });
  if (stored.size !== m.bytes) {
    return NextResponse.json({ error: `The stored file is ${stored.size} bytes, not ${m.bytes}.` }, { status: 409 });
  }

  const previous = await findChunk(m.symbol, m.resolution, m.period);
  const row = {
    symbol: m.symbol, resolution: m.resolution, period: m.period, key, sha256: m.sha256,
    rows: m.rows, bytes: m.bytes,
    firstAt: new Date(m.firstAt * 1000), lastAt: new Date(m.lastAt * 1000),
    sourceSymbol: m.sourceSymbol, importedBy: gate.ctx.userId, updatedAt: new Date(),
  };
  await db.insert(marketChunks).values(row).onConflictDoUpdate({
    target: [marketChunks.symbol, marketChunks.resolution, marketChunks.period],
    set: row,
  });
  if (previous && previous.key !== key) await deleteObject(previous.key);

  return NextResponse.json({ ok: true });
}
