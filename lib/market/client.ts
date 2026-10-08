import { decodeBars, decodeTicks, type BarSeries, type TickSeries } from "@/lib/core/market/format";
import { gunzip } from "@/lib/core/market/bytes";
import { concatBars } from "@/lib/core/market/bars";
import { periodOf, type Resolution } from "@/lib/core/market/periods";
import { cacheGet, cachePut } from "./cache";
import type { ManifestChunk } from "./importer";

/**
 * Reading market data in the browser.
 *
 * Asks the server which files exist, then gets each file from the browser's
 * own cache when it has it and from the bucket when it does not. The server is
 * only asked for the list — the bytes come straight from storage, and after
 * the first visit, from this device.
 */

/** Download links last an hour; a list is reused for a little less than that. */
const MANIFEST_TTL_MS = 45 * 60 * 1000;
const manifests = new Map<string, { at: number; chunks: Promise<ManifestChunk[]> }>();

export function manifest(symbol: string, resolution: Resolution, from?: string, to?: string): Promise<ManifestChunk[]> {
  const key = `${symbol}|${resolution}|${from ?? ""}|${to ?? ""}`;
  const hit = manifests.get(key);
  if (hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.chunks;
  const q = new URLSearchParams({ symbol, resolution, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const chunks = fetch(`/api/market/manifest?${q}`, { credentials: "same-origin" })
    .then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      return ((await r.json()) as { chunks: ManifestChunk[] }).chunks;
    });
  manifests.set(key, { at: Date.now(), chunks });
  chunks.catch(() => manifests.delete(key));
  return chunks;
}

/** Forget cached lists, so the next request gets fresh download links. */
function forgetManifests(symbol: string, resolution: Resolution) {
  for (const k of manifests.keys()) if (k.startsWith(`${symbol}|${resolution}|`)) manifests.delete(k);
}

/**
 * Every stored bar file of one resolution, by period. Minute files are one per
 * month (about 140 for a decade) and hourly and daily ones one per year, so
 * the whole list is one small request.
 */
export async function catalogue(symbol: string, resolution: Exclude<Resolution, "tick">): Promise<Map<string, ManifestChunk>> {
  const list = await manifest(symbol, resolution);
  return new Map(list.map((c) => [c.period, c]));
}

export interface LoadStats { files: number; fromCache: number; bytes: number }
export const emptyStats = (): LoadStats => ({ files: 0, fromCache: 0, bytes: 0 });

/* A few downloads at a time: a phone on 4G does better with four streams than forty. */
const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

/**
 * One stored file, decompressed. A link that has expired (the page was open
 * for over an hour) is refreshed once from a new list.
 */
async function fileBytes(symbol: string, resolution: Resolution, c: ManifestChunk, stats: LoadStats): Promise<Uint8Array> {
  stats.files++;
  const cached = await cacheGet(c.sha256);
  if (cached) { stats.fromCache++; return gunzip(cached); }
  return slot(async () => {
    let res = await fetch(c.url);
    if (res.status === 403 || res.status === 400) {
      forgetManifests(symbol, resolution);
      const fresh = (await manifest(symbol, resolution, c.period, c.period)).find((x) => x.period === c.period);
      if (fresh) res = await fetch(fresh.url);
    }
    if (!res.ok) throw new Error(`Could not download market data (${res.status}).`);
    const gz = new Uint8Array(await res.arrayBuffer());
    stats.bytes += gz.length;
    void cachePut(c.sha256, gz);
    return gunzip(gz);
  });
}

/** Bars from the given files, joined in time order. */
export async function loadBarFiles(symbol: string, resolution: Exclude<Resolution, "tick">, chunks: ManifestChunk[], stats: LoadStats = emptyStats()): Promise<BarSeries | null> {
  if (!chunks.length) return null;
  const sorted = [...chunks].sort((a, b) => a.period.localeCompare(b.period));
  const parts = await Promise.all(sorted.map(async (c) => decodeBars(await fileBytes(symbol, resolution, c, stats))));
  const nonEmpty = parts.filter((p) => p.count > 0);
  return nonEmpty.length ? concatBars(nonEmpty) : null;
}

/** One UTC day of ticks, or null if the day is not held. */
export async function loadTickDay(symbol: string, daySec: number): Promise<{ ticks: TickSeries | null; stats: LoadStats }> {
  const stats = emptyStats();
  const day = periodOf("tick", daySec);
  const [c] = await manifest(symbol, "tick", day, day);
  if (!c) return { ticks: null, stats };
  return { ticks: decodeTicks(await fileBytes(symbol, "tick", c, stats)), stats };
}
