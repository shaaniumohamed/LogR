import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { marketChunks } from "@/lib/db/schema";
import { readOrDegrade } from "@/lib/db/schema-check";
import { requestContext, type RequestContext } from "@/lib/session";
import { storageConfigured } from "@/lib/storage";
import { RESOLUTIONS, periodEnd, periodStart, type Resolution } from "@/lib/core/market/periods";

/**
 * The server side of the market data store: who may write, what a valid file
 * description looks like, and the catalogue queries.
 *
 * The bytes never pass through here — the browser uploads straight to the
 * bucket with a short-lived link — so everything the server knows about a
 * file is what the browser CLAIMS until the commit step checks the stored
 * object's size against it. Every claim is validated as if it were hostile.
 */

export const ChunkMeta = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{3,12}$/),
  sourceSymbol: z.string().regex(/^[A-Za-z0-9._#-]{1,24}$/),
  resolution: z.enum(RESOLUTIONS as [Resolution, ...Resolution[]]),
  period: z.string().max(10),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive().max(64 * 1024 * 1024),
  rows: z.number().int().positive().max(20_000_000),
  /** Epoch seconds of the first and last tick or bar in the file. */
  firstAt: z.number().int(),
  lastAt: z.number().int(),
}).refine((m) => {
  const start = periodStart(m.resolution, m.period);
  const end = periodEnd(m.resolution, m.period);
  return Number.isFinite(start) && m.firstAt >= start && m.lastAt < end && m.firstAt <= m.lastAt;
}, { message: "The period and the times inside it do not agree." });

export type ChunkMeta = z.infer<typeof ChunkMeta>;

type Gate = { ctx: RequestContext; error?: undefined } | { ctx?: undefined; error: NextResponse };

/** Signed in, with access. Market data is shared with everyone invited. */
export async function readerGate(): Promise<Gate> {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!storageConfigured()) return { error: NextResponse.json({ error: "Storage is not set up." }, { status: 503 }) };
  return { ctx };
}

/** Owners only: one person's bad import would otherwise be everyone's bad data. */
export async function ownerGate(): Promise<Gate> {
  const g = await readerGate();
  if (g.error) return g;
  if (!g.ctx.isOwner) return { error: NextResponse.json({ error: "Only an owner can change the price history." }, { status: 403 }) };
  return g;
}

export async function findChunk(symbol: string, resolution: Resolution, period: string) {
  const [row] = await db.select().from(marketChunks).where(and(
    eq(marketChunks.symbol, symbol), eq(marketChunks.resolution, resolution), eq(marketChunks.period, period),
  )).limit(1);
  return row ?? null;
}

/** Files for one symbol and resolution, oldest first, optionally within [from, to] periods. */
export async function listChunks(symbol: string, resolution: Resolution, from?: string, to?: string) {
  return readOrDegrade(() => db.select().from(marketChunks).where(and(
    eq(marketChunks.symbol, symbol),
    eq(marketChunks.resolution, resolution),
    from ? gte(marketChunks.period, from) : undefined,
    to ? lte(marketChunks.period, to) : undefined,
  )).orderBy(asc(marketChunks.period)), []);
}

export interface CoverageSummary {
  symbol: string;
  sourceSymbol: string;
  days: number;
  ticks: number;
  bytes: number;
  first: Date;
  last: Date;
}

/** One line per symbol: how much is held, from when to when. */
export async function coverageSummary(): Promise<CoverageSummary[]> {
  return readOrDegrade(async () => {
    const rows = await db.select({
      symbol: marketChunks.symbol,
      sourceSymbol: sql<string>`max(${marketChunks.sourceSymbol})`,
      days: sql<number>`count(*) filter (where ${marketChunks.resolution} = 'tick')::int`,
      ticks: sql<number>`coalesce(sum(${marketChunks.rows}) filter (where ${marketChunks.resolution} = 'tick'), 0)::float8`,
      bytes: sql<number>`coalesce(sum(${marketChunks.bytes}), 0)::float8`,
      first: sql<Date>`min(${marketChunks.firstAt})`,
      last: sql<Date>`max(${marketChunks.lastAt})`,
    }).from(marketChunks).groupBy(marketChunks.symbol).orderBy(asc(marketChunks.symbol));
    return rows.map((r) => ({ ...r, first: new Date(r.first), last: new Date(r.last) }));
  }, []);
}

/** Tick counts per UTC day for one symbol — the coverage calendar. */
export async function dailyTicks(symbol: string): Promise<{ day: string; ticks: number }[]> {
  return readOrDegrade(async () => {
    const rows = await db.select({ day: marketChunks.period, ticks: marketChunks.rows }).from(marketChunks)
      .where(and(eq(marketChunks.symbol, symbol), eq(marketChunks.resolution, "tick")))
      .orderBy(asc(marketChunks.period));
    return rows.map((r) => ({ day: r.day, ticks: r.ticks }));
  }, []);
}
