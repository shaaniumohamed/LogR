import type { BarSeries, TickSeries } from "@/lib/core/market/format";
import { concatBars, type Timeframe } from "@/lib/core/market/bars";
import { barSpan } from "@/lib/core/replay/clock";
import { closedBetween, foldBars, foldTicks, joinParts, lowerBoundMs, type Candle } from "@/lib/core/replay/forming";
import { feedTicks } from "@/lib/core/replay/ticks";
import type { PauseReason } from "@/lib/core/replay/pauses";
import { Broker, type ActionResult, type SimAction, type SimEvent, type SimSettings, type SimState } from "@/lib/core/sim/broker";
import { catalogue, loadBarFiles, loadTickDay, manifest } from "./client";

/**
 * The replay, in the browser: a clock, the market data around it, and the
 * simulated account fed every tick the clock passes.
 *
 * Data is fetched as the clock needs it — one day of ticks at a time (the next
 * one fetched ahead while playing) and one month of minute bars — and kept in
 * small caches, so a session can run through weeks without holding them all.
 *
 * The chart is never given anything after the clock: closed candles come from
 * the minute bars before the current candle, the forming candle from the
 * minutes and ticks up to the clock itself.
 */

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

class Cache<T> {
  private map = new Map<string, Promise<T>>();
  readonly ready = new Map<string, T>();
  constructor(private readonly limit: number, private readonly load: (key: string) => Promise<T>) {}
  get(key: string): Promise<T> {
    let p = this.map.get(key);
    if (!p) {
      p = this.load(key).then((v) => { this.ready.set(key, v); return v; });
      p.catch(() => this.map.delete(key));
      this.map.set(key, p);
      // Oldest out first; whatever is still needed is simply fetched again (from this device's cache).
      while (this.map.size > this.limit) {
        const oldest = this.map.keys().next().value!;
        this.map.delete(oldest);
        this.ready.delete(oldest);
      }
    }
    return p;
  }
}

export interface ReplayListener {
  /** The clock moved or the data under it arrived: redraw. */
  onFrame(): void;
  /** What the account did: fills, closes, finished trades. */
  onSim(events: SimEvent[]): void;
  /** Playing, paused, or waiting for data. */
  onStatus(s: { playing: boolean; loading: string | null }): void;
  /** The replay stopped by itself, on the tick that mattered. */
  onPause?(reason: PauseReason): void;
}

/** When to stop by itself: on account events, and at moments ahead (news, session opens). */
export interface PausePolicy {
  event(e: SimEvent): PauseReason | null;
  point(afterMs: number, uptoMs: number): { at: number; reason: PauseReason } | null;
}

export class Replay {
  clock: number;
  playing = false;
  /** Market seconds per real second. */
  speed = 60;
  readonly broker: Broker;
  readonly decimals: number;
  /** When to stop by itself; null never does. */
  pausePolicy: PausePolicy | null = null;

  private ticks: Cache<TickSeries | null>;
  private months: Cache<BarSeries | null>;
  private held: Cache<Set<string>>;
  private m1Chunks: Promise<Map<string, import("./importer").ManifestChunk>> | null = null;
  private frame = 0;
  private last = 0;
  private busy = false;
  /**
   * Closed candles from `until` up to `upTo` (the forming candle's start).
   * Grown in place as the clock moves on — only the minutes since the last
   * frame are rolled up — so playing fast does not rebuild days of candles
   * sixty times a second.
   */
  private closedCache: { tf: string; until: number; upTo: number; candles: Candle[] } | null = null;
  /** The minute files under the clock, joined once per set of months. */
  private joined: { key: string; bars: BarSeries | null } | null = null;

  constructor(readonly symbol: string, settings: SimSettings, state: SimState | null, clockMs: number, private readonly listener: ReplayListener, decimals = 3) {
    this.decimals = decimals;
    this.clock = clockMs;
    this.broker = new Broker(settings, state ?? undefined, clockMs);
    this.ticks = new Cache(5, async (day) => (await loadTickDay(symbol, dayStartMs(day) / 1000)).ticks);
    this.months = new Cache(4, async (month) => {
      this.m1Chunks ??= catalogue(symbol, "m1");
      const c = (await this.m1Chunks).get(month);
      return c ? loadBarFiles(symbol, "m1", [c]) : null;
    });
    this.held = new Cache(6, async (month) => {
      const list = await manifest(symbol, "tick", `${month}-01`, `${month}-31`);
      return new Set(list.map((c) => c.period));
    });
  }

  /** Load what the clock needs and give the account its first price. */
  async init(): Promise<void> {
    this.status("Loading prices…");
    // An account saved while trades were open resumes from its own last tick.
    const s = this.broker.state;
    if (s.positions.length + s.orders.length > 0 && Number.isFinite(s.time) && s.time < this.clock) {
      const target = this.clock;
      this.clock = s.time;
      // Back to where it was saved, without stopping on the way: this already happened.
      await this.advance(target, { noPause: true });
    }
    await Promise.all([this.ticks.get(dayOf(this.clock)), this.months.get(monthOf(this.clock))]);
    if (!this.broker.hasPrices || this.broker.state.time < this.clock - DAY_MS) this.primePrices();
    this.status(null);
    this.listener.onFrame();
  }

  /* ---------------------------------------------------------- playing */

  play() {
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    this.status(null);
    const loop = (now: number) => {
      if (!this.playing) return;
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      if (this.busy) return;
      void this.advance(this.clock + dt * this.speed, { fromPlay: true });
    };
    this.frame = requestAnimationFrame(loop);
  }

  pause() {
    const was = this.playing;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.status(null);
    // While playing the chart is redrawn a few times a second: draw exactly where it stopped.
    if (was) this.listener.onFrame();
  }

  /**
   * Move forward to `target` (ms), passing every tick to the account.
   *
   * It stops early, on the exact tick, when the account does something the
   * pause policy cares about (a stop hit, an order filled); playing, it also
   * stops at the policy's next moment (before news, at a session open).
   */
  async advance(target: number, opts: { fromPlay?: boolean; noPause?: boolean } = {}): Promise<void> {
    if (target <= this.clock) return;
    const policy = opts.noPause ? null : this.pausePolicy;
    let ahead: PauseReason | null = null;
    if (opts.fromPlay && policy) {
      const p = policy.point(this.clock, target);
      if (p) { target = p.at; ahead = p.reason; }
    }
    this.busy = true;
    const events: SimEvent[] = [];
    let stopped: PauseReason | null = null;
    const stopOn = policy ? (e: SimEvent) => (stopped ??= policy.event(e)) !== null : undefined;
    try {
      while (this.clock < target) {
        const day = dayOf(this.clock);
        let ticks = this.ticks.ready.get(day);
        if (ticks === undefined) {
          this.status("Loading prices…");
          ticks = await this.ticks.get(day);
          this.status(null);
        }
        const dayEnd = dayStartMs(day) + DAY_MS;
        const end = Math.min(target, dayEnd);
        const at = ticks ? this.feed(ticks, this.clock, end, events, stopOn) : null;
        if (at !== null) { this.clock = at; break; }
        this.clock = end;
        if (opts.fromPlay && end === dayEnd) break; // one day per frame at most
      }
      if (!stopped && ahead && this.clock >= target) stopped = ahead;
      if (opts.fromPlay && !stopped) await this.skipQuiet();
      // Fetch ahead while playing, so the next day is there when the clock arrives.
      if (this.playing && !stopped) void this.ticks.get(dayOf(this.clock + DAY_MS / 2));
    } finally {
      this.busy = false;
    }
    if (stopped) this.halt(stopped);
    if (events.length) this.listener.onSim(events);
    this.listener.onFrame();
  }

  /** Jump to `target`. Backwards only with nothing open; forwards processes everything in between. */
  async jump(target: number): Promise<string | null> {
    if (target === this.clock) return null;
    if (target < this.clock) {
      const s = this.broker.state;
      if (s.positions.length || s.orders.length) return "Close your trades and cancel your orders before going back in time.";
      this.pause();
      this.clock = target;
      this.closedCache = null;
      await this.ticks.get(dayOf(target));
      this.primePrices();
      this.listener.onFrame();
      return null;
    }
    this.pause();
    const open = this.broker.state.positions.length + this.broker.state.orders.length > 0;
    if (!open) {
      // Nothing to manage: skip straight there.
      this.clock = target;
      await Promise.all([this.ticks.get(dayOf(target)), this.months.get(monthOf(target))]);
      this.primePrices();
      this.listener.onFrame();
      return null;
    }
    this.status("Playing through to there…");
    await this.advance(target, {});
    this.status(null);
    return null;
  }

  /** Place, change or close something at the current price. */
  act(action: SimAction): ActionResult {
    const r = this.broker.act(action);
    if (r.ok && r.events.length) this.listener.onSim(r.events);
    if (r.ok) this.listener.onFrame();
    return r;
  }

  /* ---------------------------------------------------------- candles */

  /**
   * The candles for `tf` after `untilSec` (where the stored history the chart
   * already has stops) up to the clock: closed ones, and the one forming.
   * Null while the data under them is still arriving.
   */
  candles(tf: Timeframe, untilSec: number): { closed: Candle[]; forming: Candle | null } | null {
    const clockSec = Math.floor(this.clock / 1000);
    const span = barSpan(tf, clockSec);
    const m1 = this.minutes(Math.min(untilSec, span.start) * 1000, this.clock);
    if (m1 === undefined) return null;

    // Closed candles: rebuilt when the timeframe, the stored history's end or
    // the direction of time changes; otherwise only the new ones are added.
    let c = this.closedCache;
    if (!c || c.tf !== tf.key || c.until !== untilSec || span.start < c.upTo) {
      c = this.closedCache = { tf: tf.key, until: untilSec, upTo: span.start, candles: closedBetween(m1, tf, untilSec, span.start) };
    } else if (span.start > c.upTo) {
      for (const x of closedBetween(m1, tf, Math.max(untilSec, c.upTo), span.start)) c.candles.push(x);
      c.upTo = span.start;
    }

    // The forming one: whole minutes so far, then this minute's ticks.
    const minuteStart = Math.floor(clockSec / 60) * 60;
    const ticks = this.ticks.ready.get(dayOf(this.clock)) ?? null;
    const forming = joinParts(span.key, m1?.decimals ?? ticks?.decimals ?? this.decimals,
      foldBars(m1, span.start, minuteStart),
      foldTicks(ticks, Math.max(span.start, minuteStart) * 1000, this.clock));
    return { closed: c.candles, forming };
  }

  /** The latest prices the account has seen. */
  get prices() { return { bid: this.broker.state.bid, ask: this.broker.state.ask }; }

  destroy() { this.playing = false; cancelAnimationFrame(this.frame); }

  /* ---------------------------------------------------------- inside */

  private status(loading: string | null) { this.listener.onStatus({ playing: this.playing, loading }); }

  /** Stopped by itself: not playing any more, and say why. */
  private halt(reason: PauseReason) {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.status(null);
    this.listener.onPause?.(reason);
  }

  /** Ticks in (fromMs, toMs] to the account; the time it stopped at, or null. */
  private feed(t: TickSeries, fromMs: number, toMs: number, events: SimEvent[], stopOn?: (e: SimEvent) => boolean): number | null {
    if (this.broker.state.positions.length + this.broker.state.orders.length > 0) {
      return feedTicks(this.broker, t, fromMs, toMs, events, stopOn);
    }
    // Nothing open: only the last price matters.
    const base = t.dayStart * 1000;
    const k = 10 ** t.decimals;
    const i = lowerBoundMs(t, fromMs - base + 1);
    const j = lowerBoundMs(t, toMs - base + 1) - 1;
    if (j >= 0 && (j >= i || !this.broker.hasPrices)) this.broker.tick(t.ms[j] + base, t.bid[j] / k, t.ask[j] / k);
    return null;
  }

  /** Give the account the last price at or before the clock (after a jump). */
  private primePrices() {
    const t = this.ticks.ready.get(dayOf(this.clock));
    if (!t || !t.count) return;
    const base = t.dayStart * 1000;
    const j = lowerBoundMs(t, this.clock - base + 1) - 1;
    const i = j >= 0 ? j : 0;
    const k = 10 ** t.decimals;
    // Rebuild the account at this moment if it was ahead of it (a jump back).
    const at = t.ms[i] + base;
    if (this.broker.state.time > at) {
      this.broker.state.time = at;
      // The last 22:00 UTC rollover at or before the new moment, so swap restarts from here.
      const r = Math.floor(at / DAY_MS) * DAY_MS + 22 * 3_600_000;
      this.broker.state.lastRollover = r <= at ? r : r - DAY_MS;
    }
    this.broker.tick(t.ms[i] + base, t.bid[i] / k, t.ask[i] / k);
  }

  /**
   * Past the end of the day's ticks (a weekend, a holiday, the daily break)
   * there is nothing to watch: go straight to just before the next tick.
   */
  private async skipQuiet() {
    const day = dayOf(this.clock);
    const t = this.ticks.ready.get(day);
    let next: number | null = null;
    if (t && t.count) {
      const i = lowerBoundMs(t, this.clock - t.dayStart * 1000 + 1);
      if (i < t.count) next = t.ms[i] + t.dayStart * 1000;
    }
    if (next === null) {
      for (let d = 1; d <= 14 && next === null; d++) {
        const nd = dayOf(dayStartMs(day) + d * DAY_MS);
        const held = await this.held.get(nd.slice(0, 7));
        if (!held.has(nd)) continue;
        const nt = await this.ticks.get(nd);
        if (nt && nt.count) next = nt.ms[0] + nt.dayStart * 1000;
      }
    }
    // Only when waiting would take more than a second and a half of real time.
    if (next !== null && next - this.clock > Math.max(120_000, this.speed * 1500)) this.clock = next - 1000;
  }

  /** Minute bars covering [fromMs, toMs]: undefined while loading. */
  private minutes(fromMs: number, toMs: number): BarSeries | null | undefined {
    const months: string[] = [];
    for (let m = monthOf(fromMs); m <= monthOf(toMs); m = nextMonth(m)) months.push(m);
    if (months.length > 3) months.splice(0, months.length - 3);
    const key = months.join(",");
    if (this.joined?.key === key) return this.joined.bars;
    const parts: BarSeries[] = [];
    let missing = false;
    for (const m of months) {
      const v = this.months.ready.get(m);
      if (v === undefined) { missing = true; void this.months.get(m).then(() => this.listener.onFrame()); continue; }
      if (v && v.count) parts.push(v);
    }
    if (missing) return undefined;
    const bars = parts.length > 1 ? concatBars(parts) : parts[0] ?? null;
    this.joined = { key, bars };
    return bars;
  }
}

function nextMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
