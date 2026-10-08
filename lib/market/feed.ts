import type { BarSeries } from "@/lib/core/market/format";
import { concatBars, forTimeframe, type Timeframe } from "@/lib/core/market/bars";
import { filterBars } from "@/lib/core/market/merge";
import { periodOf, periodStart } from "@/lib/core/market/periods";
import { catalogue, emptyStats, loadBarFiles, type LoadStats } from "./client";
import type { ManifestChunk } from "./importer";

/**
 * Candles for one timeframe over a stretch of history that grows as the chart
 * is scrolled — the way TradingView loads more to the left as you drag.
 *
 * History is stored as files (one per month of minute bars, one per year of
 * hourly and daily bars), so the feed loads whole files: one more month to the
 * left or right for the minute timeframes, one more year for the hourly ones.
 * Daily and weekly candles are small enough to load all at once.
 *
 * The candles are rebuilt from the joined source bars after every load, not
 * stitched from per-file candles: a weekly candle that straddles New Year is
 * one candle, not two halves.
 *
 * Memory is capped by the number of files held. Going past it drops files from
 * the far side, which are fetched again (from this device's cache) if the
 * chart is scrolled back there.
 */

type Source = Timeframe["source"];

/** Files held at once, and how many to start with either side of the anchor. */
const LIMITS: Record<Source, { max: number; around: number }> = {
  m1: { max: 6, around: 1 },   // ~30k minute bars a month
  h1: { max: 14, around: 1 },  // ~6k hourly bars a year
  d1: { max: Infinity, around: Infinity },
};

export class BarFeed {
  readonly stats: LoadStats = emptyStats();
  bars: BarSeries | null = null;

  private periods: string[] = [];
  private chunks = new Map<string, ManifestChunk>();
  private parts = new Map<string, BarSeries>();
  private lo = 0;
  private hi = -1;
  private busy: Promise<unknown> = Promise.resolve();

  private constructor(readonly symbol: string, readonly tf: Timeframe, readonly until?: number) {}

  /**
   * A feed with the files around `anchor` (epoch seconds) loaded — the latest
   * files when there is no anchor. `until` (exclusive) hides everything at or
   * after that moment, for replay.
   */
  static async open(symbol: string, tf: Timeframe, opts: { anchor?: number; until?: number } = {}): Promise<BarFeed> {
    const feed = new BarFeed(symbol, tf, opts.until);
    await feed.start(opts.anchor);
    return feed;
  }

  get hasOlder() { return this.lo > 0; }
  get hasNewer() {
    if (this.hi >= this.periods.length - 1) return false;
    return this.until === undefined || periodStart(this.tf.source, this.periods[this.hi + 1]) < this.until;
  }
  /** First and last periods held, for a status line. */
  get span(): [string, string] | null { return this.hi >= this.lo && this.periods.length ? [this.periods[this.lo], this.periods[this.hi]] : null; }

  /** Index of the first candle at or after `t`; `count` when there is none. */
  indexAt(t: number): number {
    const b = this.bars;
    if (!b) return 0;
    let lo = 0, hi = b.count;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (b.time[mid] < t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Load one more file to the left. Resolves false when there is nothing older. */
  older(): Promise<boolean> {
    return this.serial(async () => {
      if (!this.hasOlder) return false;
      await this.load([this.periods[this.lo - 1]]);
      this.lo--;
      while (this.hi - this.lo + 1 > LIMITS[this.tf.source].max) this.parts.delete(this.periods[this.hi--]);
      this.rebuild();
      return true;
    });
  }

  /** Load one more file to the right. Resolves false when there is nothing newer. */
  newer(): Promise<boolean> {
    return this.serial(async () => {
      if (!this.hasNewer) return false;
      await this.load([this.periods[this.hi + 1]]);
      this.hi++;
      while (this.hi - this.lo + 1 > LIMITS[this.tf.source].max) this.parts.delete(this.periods[this.lo++]);
      this.rebuild();
      return true;
    });
  }

  private async start(anchor?: number) {
    const src = this.tf.source;
    this.chunks = await catalogue(this.symbol, src);
    this.periods = [...this.chunks.keys()].sort();
    if (this.until !== undefined) this.periods = this.periods.filter((p) => periodStart(src, p) < this.until!);
    if (!this.periods.length) return;

    // The file holding the anchor, or the nearest one before it.
    let at = this.periods.length - 1;
    if (anchor !== undefined) {
      const want = periodOf(src, anchor);
      at = 0;
      for (let i = 0; i < this.periods.length && this.periods[i] <= want; i++) at = i;
    }
    const around = LIMITS[src].around;
    this.lo = Math.max(0, at - around);
    this.hi = Math.min(this.periods.length - 1, at + around);
    await this.load(this.periods.slice(this.lo, this.hi + 1));
    this.rebuild();
  }

  private async load(periods: string[]) {
    const missing = periods.filter((p) => !this.parts.has(p));
    await Promise.all(missing.map(async (p) => {
      const c = this.chunks.get(p);
      const bars = c ? await loadBarFiles(this.symbol, this.tf.source, [c], this.stats) : null;
      if (bars) this.parts.set(p, bars);
    }));
  }

  private rebuild() {
    const parts: BarSeries[] = [];
    for (let i = this.lo; i <= this.hi; i++) {
      const p = this.parts.get(this.periods[i]);
      if (p && p.count) parts.push(p);
    }
    if (!parts.length) { this.bars = null; return; }
    let src = concatBars(parts);
    if (this.until !== undefined) { const until = this.until; src = filterBars(src, (t) => t < until); }
    this.bars = src.count ? forTimeframe(src, this.tf) : null;
  }

  /** One load at a time, in the order asked. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }
}
