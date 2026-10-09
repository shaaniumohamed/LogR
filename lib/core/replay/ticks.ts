import type { TickSeries } from "@/lib/core/market/format";
import type { Broker, SimEvent } from "@/lib/core/sim/broker";
import { lowerBoundMs } from "./forming";

/**
 * Give the account every tick in (fromMs, toMs], in order.
 *
 * With `stopOn`, it stops after the tick that caused an event worth stopping
 * for (a stop-loss hit, an order filled) and returns that tick's time, so the
 * replay can pause on the exact tick instead of wherever the frame ended. The
 * other ticks stamped with the same millisecond are fed first: resuming starts
 * strictly after the clock, so leaving them would skip them — and nobody can
 * act between two ticks in the same millisecond anyway. Returns null when it
 * ran all the way to `toMs`.
 */
export function feedTicks(
  broker: Broker, t: TickSeries, fromMs: number, toMs: number,
  events: SimEvent[], stopOn?: (e: SimEvent) => boolean,
): number | null {
  const base = t.dayStart * 1000;
  const k = 10 ** t.decimals;
  for (let i = lowerBoundMs(t, fromMs - base + 1); i < t.count && t.ms[i] + base <= toMs; i++) {
    const ev = broker.tick(t.ms[i] + base, t.bid[i] / k, t.ask[i] / k);
    if (!ev.length) continue;
    for (const e of ev) events.push(e);
    if (stopOn && ev.some(stopOn)) {
      const ms = t.ms[i];
      for (i++; i < t.count && t.ms[i] === ms; i++) {
        for (const e of broker.tick(ms + base, t.bid[i] / k, t.ask[i] / k)) events.push(e);
      }
      return ms + base;
    }
  }
  return null;
}
