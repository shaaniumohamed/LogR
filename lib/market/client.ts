import { decodeBars, decodeTicks, type BarSeries, type TickSeries } from "@/lib/core/market/format";
import { gunzip } from "@/lib/core/market/bytes";
import { concatBars, forTimeframe, type Timeframe } from "@/lib/core/market/bars";
import { filterBars } from "@/lib/core/market/merge";
import { periodOf, periodsBetween, type Resolution } from "@/lib/core/market/periods";
import { cacheGet, cachePut } from "./cache";
import type { ManifestChunk } from "./importer";

/**
 * Reading market data in the browser.
 *
 * Asks the server which files cover a span, then gets each file from the
 * browser's own cache when it has it and from the bucket when it does not. The
 * server is only asked for the list — the bytes come straight from storage, and
 * after the first visit, from this device.
 */

/** Download links last an hour; the list is reused for a little less than that. */
const MANIFEST_TTL_MS = 45 * 60 * 1000;
const manifests = new Map<string, { at: number; chunks: Promise<ManifestChunk[]> }>();

export function manifest(symbol: string, resolution: Resolution, from: string, to: string): Promise<ManifestChunk[]> {
  const key = `${symbol}|${resolution}|${from}|${to}`;
  const hit = manifests.get(key);
  if (hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.chunks;
  const chunks = fetch(`/api/market/manifest?${new URLSearchParams({ symbol, resolution, from, to })}`, { credentials: "same-origin" })
    .then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      return ((await r.json()) as { chunks: ManifestChunk[] }).chunks;
    });
  manifests.set(key, { at: Date.now(), chunks });
  chunks.catch(() => manifests.delete(key));
  return chunks;
}

export interface LoadStats { files: number; fromCache: number; bytes: number }

async function fileBytes(c: ManifestChunk, stats: LoadStats): Promise<Uint8Array> {
  stats.files++;
  const cached = await cacheGet(c.sha256);
  if (cached) { stats.fromCache++; return gunzip(cached); }
  const res = await fetch(c.url);
  if (!res.ok) throw new Error(`Could not download market data (${res.status}).`);
  const gz = new Uint8Array(await res.arrayBuffer());
  stats.bytes += gz.length;
  void cachePut(c.sha256, gz);
  return gunzip(gz);
}

const SOURCE_RES: Record<Timeframe["source"], Exclude<Resolution, "tick">> = { m1: "m1", h1: "h1", d1: "d1" };

/**
 * Candles for one timeframe over [from, to) epoch seconds, built from whichever
 * stored resolution that timeframe comes from (see timeframes()).
 */
export async function loadCandles(symbol: string, tf: Timeframe, from: number, to: number): Promise<{ bars: BarSeries | null; stats: LoadStats }> {
  const stats: LoadStats = { files: 0, fromCache: 0, bytes: 0 };
  const res = SOURCE_RES[tf.source];
  const periods = periodsBetween(res, from, to);
  if (!periods.length) return { bars: null, stats };
  const list = await manifest(symbol, res, periods[0], periods[periods.length - 1]);
  if (!list.length) return { bars: null, stats };
  const parts = await Promise.all(list.map(async (c) => decodeBars(await fileBytes(c, stats))));
  const joined = filterBars(concatBars(parts), (t) => t >= from && t < to);
  return { bars: joined.count ? forTimeframe(joined, tf) : null, stats };
}

/** One UTC day of ticks, or null if the day is not held. */
export async function loadTickDay(symbol: string, daySec: number): Promise<{ ticks: TickSeries | null; stats: LoadStats }> {
  const stats: LoadStats = { files: 0, fromCache: 0, bytes: 0 };
  const day = periodOf("tick", daySec);
  const [c] = await manifest(symbol, "tick", day, day);
  if (!c) return { ticks: null, stats };
  return { ticks: decodeTicks(await fileBytes(c, stats)), stats };
}
