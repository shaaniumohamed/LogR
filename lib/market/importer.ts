import { Unzip, UnzipInflate } from "fflate";
import { ExnessTickParser, TickDayAccumulator, storageDecimals, type TickDay, type TickParseStats } from "@/lib/core/market/exness-ticks";
import { decodeBars, decodeTicks, encodeBars, encodeTicks, type BarSeries, type TickSeries } from "@/lib/core/market/format";
import { concatBars, fixedBucket, rollup, ticksToM1 } from "@/lib/core/market/bars";
import { filterBars, mergeBars, mergeTicks } from "@/lib/core/market/merge";
import { gunzip, gzip, sha256Hex } from "@/lib/core/market/bytes";
import { periodOf, type Resolution } from "@/lib/core/market/periods";
import { normalizeSymbol } from "@/lib/core/symbols";

/**
 * Importing a tick history file into the market data store.
 *
 * Runs in a Web Worker in the browser (and in Node for the tests and the
 * command-line import). The file is read as a stream — a year of gold is ~2 GB
 * of text inside a few hundred MB of zip — so memory holds one day of ticks
 * and one month of minute bars, never the file.
 *
 * What it writes, per docs/30-backtesting.md:
 *   - one tick file per UTC day,
 *   - one M1 file per month, built from those days,
 *   - one H1 and one D1 file per year, built from the months.
 * Where the store already holds some of that, the new data replaces exactly
 * the days it brings and keeps the rest (see merge.ts).
 *
 * Every write is two calls — ask for an upload link, then confirm — and the
 * first one answers "skip" when the store already has that exact file. That is
 * what makes an interrupted import safe to simply run again.
 */

export interface ManifestChunk {
  period: string;
  sha256: string;
  url: string;
  rows: number;
}

export interface ChunkDescription {
  symbol: string;
  sourceSymbol: string;
  resolution: Resolution;
  period: string;
  sha256: string;
  bytes: number;
  rows: number;
  firstAt: number;
  lastAt: number;
}

/** The server, as the importer needs it. Real one: httpMarketApi below. */
export interface MarketApi {
  manifest(symbol: string, resolution: Resolution, from?: string, to?: string): Promise<ManifestChunk[]>;
  requestUpload(meta: ChunkDescription): Promise<{ skip: true } | { skip?: false; key: string; url: string }>;
  put(url: string, body: Uint8Array): Promise<void>;
  commit(meta: ChunkDescription): Promise<void>;
  download(url: string): Promise<Uint8Array>;
}

export interface ImportProgress {
  phase: "reading" | "finishing" | "done";
  bytesRead: number;
  totalBytes: number;
  symbol: string | null;
  sourceSymbol: string | null;
  ticks: number;
  days: number;
  currentDay: string | null;
  uploaded: number;
  skipped: number;
  uploadedBytes: number;
}

export interface ImportReport extends ImportProgress {
  parse: TickParseStats;
  /** Ticks for a day already finished — out of order across days; not imported. */
  late: number;
  /** Ticks put back in time order within their day. */
  reordered: number;
  firstDay: string | null;
  lastDay: string | null;
}

export interface ImportOptions {
  source: Blob;
  api: MarketApi;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  /** Uploads in flight at once. */
  concurrency?: number;
}

const isZip = async (b: Blob) => {
  const head = new Uint8Array(await b.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
};

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const { source, api, signal } = opts;
  const limit = Math.max(1, opts.concurrency ?? 4);
  const progress: ImportProgress = {
    phase: "reading", bytesRead: 0, totalBytes: source.size, symbol: null, sourceSymbol: null,
    ticks: 0, days: 0, currentDay: null, uploaded: 0, skipped: 0, uploadedBytes: 0,
  };
  let lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastReport > 250) { lastReport = now; opts.onProgress?.({ ...progress }); }
  };
  const checkAbort = () => { if (signal?.aborted) throw new DOMException("Import cancelled.", "AbortError"); };

  /* ---------------------------------------------------- what is stored */

  // Per year, what the store already holds — fetched when the import first
  // reaches that year, so a decade of history is never listed at once.
  const known = new Map<string, Map<string, ManifestChunk>>();
  async function manifestFor(symbol: string, year: string): Promise<Map<string, ManifestChunk>> {
    let m = known.get(year);
    if (m) return m;
    m = new Map();
    const [ticks, m1, h1, d1] = await Promise.all([
      api.manifest(symbol, "tick", `${year}-01-01`, `${year}-12-31`),
      api.manifest(symbol, "m1", `${year}-01`, `${year}-12`),
      api.manifest(symbol, "h1", year, year),
      api.manifest(symbol, "d1", year, year),
    ]);
    for (const c of ticks) m.set(`tick:${c.period}`, c);
    for (const c of m1) m.set(`m1:${c.period}`, c);
    for (const c of h1) m.set(`h1:${c.period}`, c);
    for (const c of d1) m.set(`d1:${c.period}`, c);
    known.set(year, m);
    return m;
  }

  /* ---------------------------------------------------------- uploads */

  const inflight = new Set<Promise<void>>();
  let failure: unknown = null;

  async function store(meta: Omit<ChunkDescription, "sha256" | "bytes">, raw: Uint8Array): Promise<void> {
    const body = await gzip(raw);
    const full: ChunkDescription = { ...meta, sha256: await sha256Hex(body), bytes: body.length };
    // Wait for a free slot: this is what keeps a fast parser from queueing up
    // gigabytes of encoded days behind a slow connection.
    while (inflight.size >= limit) await Promise.race(inflight);
    if (failure) throw failure;
    checkAbort();
    const job = (async () => {
      const ticket = await api.requestUpload(full);
      if (ticket.skip) { progress.skipped++; return; }
      await api.put(ticket.url, body);
      await api.commit(full);
      progress.uploaded++;
      progress.uploadedBytes += body.length;
    })().catch((e) => { failure ??= e; }).finally(() => { inflight.delete(job); report(); });
    inflight.add(job);
  }

  /* ------------------------------------------------------------- days */

  let symbol = "", sourceSymbol = "", decimals = 3;
  let firstDay: string | null = null, lastDay: string | null = null;
  let reordered = 0;

  // The month and year being assembled.
  let month: string | null = null;
  let monthBars: BarSeries[] = [];
  let monthDays = new Set<number>();
  let year: string | null = null;
  let yearHours: BarSeries[] = [];
  let yearMonths = new Set<string>();

  async function processDay(day: TickDay, boundary: boolean) {
    checkAbort();
    let ticks: TickSeries = day;
    const dayYear = day.day.slice(0, 4);
    const m = await manifestFor(symbol, dayYear);

    // A file's first and last day may be only part of that day; the rest can
    // already be stored from the neighbouring file. Join the two halves.
    const existing = boundary ? m.get(`tick:${day.day}`) : undefined;
    if (existing) {
      const prev = decodeTicks(await gunzip(await api.download(existing.url)));
      if (prev.decimals === day.decimals) ticks = mergeTicks(prev, day);
    }

    const dayMonth = day.day.slice(0, 7);
    if (month !== dayMonth) { if (month) await finishMonth(); month = dayMonth; }
    if (year !== dayYear) { if (year) await finishYear(); year = dayYear; }

    await store({
      symbol, sourceSymbol, resolution: "tick", period: day.day, rows: ticks.count,
      firstAt: ticks.dayStart + Math.floor(ticks.ms[0] / 1000),
      lastAt: ticks.dayStart + Math.floor(ticks.ms[ticks.count - 1] / 1000),
    }, encodeTicks(ticks));

    monthBars.push(ticksToM1(ticks));
    monthDays.add(ticks.dayStart);
    progress.days++;
    progress.currentDay = day.day;
    firstDay ??= day.day;
    lastDay = day.day;
    report();
  }

  async function storeBars(resolution: Resolution, period: string, bars: BarSeries) {
    if (!bars.count) return;
    await store({
      symbol, sourceSymbol, resolution, period, rows: bars.count,
      firstAt: bars.time[0], lastAt: bars.time[bars.count - 1],
    }, encodeBars(bars));
  }

  async function finishMonth() {
    if (!month || !monthBars.length) return;
    let bars = concatBars(monthBars);
    const m = await manifestFor(symbol, month.slice(0, 4));
    const existing = m.get(`m1:${month}`);
    if (existing) {
      // Keep the stored minutes of every day this import did not bring.
      const days = monthDays;
      const prev = decodeBars(await gunzip(await api.download(existing.url)));
      if (prev.decimals === bars.decimals) bars = mergeBars(filterBars(prev, (t) => !days.has(t - (t % 86_400))), bars);
    }
    await storeBars("m1", month, bars);
    yearHours.push(rollup(bars, 3_600));
    yearMonths.add(month);
    monthBars = [];
    monthDays = new Set();
  }

  async function finishYear() {
    if (!year || !yearHours.length) return;
    let hours = concatBars(yearHours);
    const m = await manifestFor(symbol, year);
    const existing = m.get(`h1:${year}`);
    if (existing) {
      // Keep the stored hours of every month this import did not touch.
      const months = yearMonths;
      const prev = decodeBars(await gunzip(await api.download(existing.url)));
      if (prev.decimals === hours.decimals) hours = mergeBars(filterBars(prev, (t) => !months.has(periodOf("m1", t))), hours);
    }
    await storeBars("h1", year, hours);
    // The daily file is rebuilt whole from the year's complete hours, on raw
    // UTC days; Sunday folding happens when a chart asks for daily candles.
    await storeBars("d1", year, rollup(hours, 86_400, fixedBucket(86_400)));
    known.delete(year); // what the store holds for this year has just changed
    yearHours = [];
    yearMonths = new Set();
  }

  /* ---------------------------------------------------------- parsing */

  let acc: TickDayAccumulator | null = null;
  const ready: TickDay[] = [];
  let firstEmitted = true;
  const parser = new ExnessTickParser({
    decimalsFor: (s) => storageDecimals(s ?? "XAUUSD"),
    onTick: (t, b, a) => {
      if (!acc) {
        sourceSymbol = parser.sourceSymbol ?? "XAUUSD";
        symbol = normalizeSymbol(sourceSymbol);
        decimals = parser.decimals ?? 3;
        progress.symbol = symbol;
        progress.sourceSymbol = sourceSymbol;
        acc = new TickDayAccumulator({ symbol, decimals, onDay: (d) => { ready.push(d); } });
      }
      acc.add(t, b, a);
    },
  });

  /**
   * Handle the days the parser has finished. A day is only handed over once
   * the next one starts, so until the very end none of these can be the file's
   * last day; the one handed over by finish() is.
   */
  async function drain(final: boolean) {
    while (ready.length) {
      const d = ready.shift()!;
      reordered += d.reordered;
      const boundary = firstEmitted || (final && ready.length === 0);
      firstEmitted = false;
      await processDay(d, boundary);
      if (failure) throw failure;
    }
  }

  const decoder = new TextDecoder("utf-8");
  const reader = source.stream().getReader();
  try {
    if (await isZip(source)) {
      let entryError: unknown = null;
      const unzip = new Unzip((file) => {
        // The tick data itself; anything else in the archive (a readme) is not ticks.
        if (!/\.(csv|txt)$/i.test(file.name)) return;
        file.ondata = (err, chunk, final) => {
          if (err) { entryError = err; return; }
          parser.push(decoder.decode(chunk, { stream: !final }));
          if (final) parser.end();
        };
        file.start();
      });
      unzip.register(UnzipInflate);
      for (;;) {
        checkAbort();
        const { done, value } = await reader.read();
        if (done) { unzip.push(new Uint8Array(0), true); break; }
        progress.bytesRead += value.length;
        unzip.push(value);
        if (entryError) throw entryError;
        progress.ticks = parser.stats.ticks;
        await drain(false);
      }
    } else {
      for (;;) {
        checkAbort();
        const { done, value } = await reader.read();
        if (done) { parser.push(decoder.decode()); parser.end(); break; }
        progress.bytesRead += value.length;
        parser.push(decoder.decode(value, { stream: true }));
        progress.ticks = parser.stats.ticks;
        await drain(false);
      }
    }

    progress.phase = "finishing";
    progress.ticks = parser.stats.ticks;
    report(true);
    (acc as TickDayAccumulator | null)?.finish();
    await drain(true);
    await finishMonth();
    await finishYear();
    await Promise.all(inflight);
    if (failure) throw failure;
  } finally {
    reader.releaseLock();
  }

  progress.phase = "done";
  report(true);
  return {
    ...progress,
    parse: { ...parser.stats },
    late: (acc as TickDayAccumulator | null)?.late ?? 0,
    reordered,
    firstDay,
    lastDay,
  };
}

/* --------------------------------------------------------- the real server */

async function retrying<T>(what: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw new DOMException("Import cancelled.", "AbortError");
    try {
      return await fn();
    } catch (e) {
      last = e;
      // A refusal (4xx) will not change on a retry; a dropped connection might.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? new Error(`${what}: ${last.message}`) : last;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function ok(res: Response): Promise<Response> {
  if (res.ok) return res;
  let detail = "";
  try { detail = ((await res.json()) as { error?: string }).error ?? ""; } catch { /* not JSON */ }
  throw new HttpError(res.status, detail || `HTTP ${res.status}`);
}

/** The MarketApi over HTTP: this app's routes, plus the bucket's signed links. */
export function httpMarketApi(origin: string, signal?: AbortSignal): MarketApi {
  const json = (path: string, body: unknown) => fetch(`${origin}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, credentials: "same-origin",
  }).then(ok).then((r) => r.json());
  return {
    manifest: (symbol, resolution, from, to) => retrying("Reading the catalogue", async () => {
      const q = new URLSearchParams({ symbol, resolution, ...(from ? { from } : {}), ...(to ? { to } : {}) });
      const r = await ok(await fetch(`${origin}/api/market/manifest?${q}`, { signal, credentials: "same-origin" }));
      return ((await r.json()) as { chunks: ManifestChunk[] }).chunks;
    }, signal),
    requestUpload: (meta) => retrying("Preparing an upload", () => json("/api/market/upload", meta), signal),
    put: (url, body) => retrying("Uploading", async () => {
      await ok(await fetch(url, { method: "PUT", body: body as BodyInit, headers: { "content-type": "application/octet-stream" }, signal }));
    }, signal),
    commit: (meta) => retrying("Recording an upload", () => json("/api/market/commit", meta), signal),
    download: (url) => retrying("Downloading stored data", async () => new Uint8Array(await (await ok(await fetch(url, { signal }))).arrayBuffer()), signal),
  };
}
