import type { IndicatorSpec } from "@/lib/core/backtest";
import { emaNext, type OHLCV } from "@/lib/core/indicators";

/**
 * One indicator line kept up to date candle by candle: `reset` over the
 * history, `push` each candle as it closes, `peek` at the forming one without
 * committing it. Matches lib/core/indicators.ts exactly (tested there).
 */
export class IndicatorTrack {
  private n = 0;
  private emaPrev: number | null = null;
  private seed = 0;
  private window: number[] = [];
  private sum = 0;
  private session = NaN;
  private pv = 0;
  private vol = 0;

  constructor(readonly spec: IndicatorSpec) {}

  reset(rows: OHLCV[]): (number | null)[] {
    this.n = 0; this.emaPrev = null; this.seed = 0; this.window = []; this.sum = 0;
    this.session = NaN; this.pv = 0; this.vol = 0;
    return rows.map((r) => this.push(r));
  }

  push(r: OHLCV): number | null {
    const p = this.spec.period;
    switch (this.spec.kind) {
      case "sma": {
        this.window.push(r.close); this.sum += r.close;
        if (this.window.length > p) this.sum -= this.window.shift()!;
        return this.window.length === p ? this.sum / p : null;
      }
      case "ema": {
        this.n++;
        if (this.emaPrev === null) {
          this.seed += r.close;
          if (this.n === p) this.emaPrev = this.seed / p;
          return this.emaPrev;
        }
        this.emaPrev = emaNext(this.emaPrev, r.close, p);
        return this.emaPrev;
      }
      case "vwap": {
        const s = Math.floor(r.time / 86_400);
        if (s !== this.session) { this.session = s; this.pv = 0; this.vol = 0; }
        const w = r.volume || 1;
        this.pv += ((r.high + r.low + r.close) / 3) * w;
        this.vol += w;
        return this.pv / this.vol;
      }
    }
  }

  peek(r: OHLCV): number | null {
    const p = this.spec.period;
    switch (this.spec.kind) {
      case "sma": {
        if (this.window.length + 1 < p) return null;
        const drop = this.window.length === p ? this.window[0] : 0;
        return (this.sum + r.close - drop) / p;
      }
      case "ema":
        if (this.emaPrev !== null) return emaNext(this.emaPrev, r.close, p);
        return this.n + 1 === p ? (this.seed + r.close) / p : null;
      case "vwap": {
        const s = Math.floor(r.time / 86_400);
        const w = r.volume || 1;
        const tp = ((r.high + r.low + r.close) / 3) * w;
        return s === this.session ? (this.pv + tp) / (this.vol + w) : tp / w;
      }
    }
  }
}
