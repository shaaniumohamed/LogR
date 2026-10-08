import { NextResponse } from "next/server";
import { ChunkMeta, findChunk, ownerGate } from "@/lib/market-data";
import { uploadUrl } from "@/lib/storage";
import { chunkKey } from "@/lib/core/market/periods";

export const runtime = "nodejs";

/**
 * Step one of storing a file: describe it, get a link to upload it to.
 *
 * If the catalogue already holds this exact file — same period, same content
 * hash — the answer is "skip", which is what makes an interrupted import
 * resumable: running it again uploads only what is missing or changed.
 */
export async function POST(req: Request) {
  const gate = await ownerGate();
  if (gate.error) return gate.error;

  const parsed = ChunkMeta.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That file description is not valid." }, { status: 400 });
  const m = parsed.data;

  const existing = await findChunk(m.symbol, m.resolution, m.period);
  if (existing?.sha256 === m.sha256) return NextResponse.json({ skip: true });

  const key = chunkKey(m.symbol, m.resolution, m.period, m.sha256);
  return NextResponse.json({ key, url: uploadUrl(key) });
}
