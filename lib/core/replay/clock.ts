import type { Timeframe } from "@/lib/core/market/bars";
import { wallToUtc } from "@/lib/core/zones";

/**
 * The replay's sense of time: how fast it runs, where a step goes, and where
 * the jumps land. Pure functions of epoch seconds, so they are tested without
 * a chart.
 */

/** Real-time multipliers. Time flows at the same pace whatever the timeframe, as on a live chart. */
export const SPEEDS = [
  { x: 1, label: "1×" },
  { x: 3, label: "3×" },
  { x: 10, label: "10×" },
  { x: 30, label: "30×" },
  { x: 60, label: "1 min/s" },
  { x: 300, label: "5 min/s" },
  { x: 900, label: "15 min/s" },
  { x: 3600, label: "1 h/s" },
] as const;

const DAY = 86_400;

/**
 * The candle the moment `t` falls in.
 *
 * `key` is the candle's time on the chart; `start` is where its content
 * begins, which is earlier than `key` when Sunday's evening session is folded
 * into Monday's daily candle, or into the week ahead; `end` is when it closes.
 */
export function barSpan(tf: Timeframe, t: number): { key: number; start: number; end: number } {
  const key = tf.bucket(t);
  const start = tf.bucket(key - 1) === key ? key - DAY : key;
  return { key, start, end: key + tf.seconds };
}

/** Where "step" goes: the close of the candle now forming. */
export function stepBar(tf: Timeframe, t: number): number {
  return barSpan(tf, t).end;
}

/* -------------------------------------------------------------- sessions */

export interface MarketSession {
  id: "tokyo" | "london" | "newyork";
  label: string;
  zone: string;
  open: [number, number];
  close: [number, number];
}

/**
 * The three sessions gold traders mark, at their local opening hours, so
 * daylight saving moves them exactly as it moves the cities themselves.
 */
export const SESSIONS: MarketSession[] = [
  { id: "tokyo", label: "Tokyo", zone: "Asia/Tokyo", open: [9, 0], close: [15, 0] },
  { id: "london", label: "London", zone: "Europe/London", open: [8, 0], close: [16, 30] },
  { id: "newyork", label: "New York", zone: "America/New_York", open: [8, 0], close: [17, 0] },
];

const local = (y: number, m: number, d: number, [h, min]: [number, number], zone: string) =>
  Math.floor(wallToUtc(Date.UTC(y, m, d, h, min), zone) / 1000);

type Window = { start: number; end: number; day: string };

/**
 * One weekday's window (null on weekends). Remembered, because the chart asks
 * for the same few days on every repaint and the time-zone sums are not free.
 */
const windowMemo = new Map<string, Window | null>();
function windowOn(s: MarketSession, d: number): Window | null {
  const k = `${s.id}|${d}`;
  let w = windowMemo.get(k);
  if (w !== undefined) return w;
  const date = new Date(d * DAY * 1000);
  const wd = date.getUTCDay();
  if (wd === 0 || wd === 6) w = null;
  else {
    const y = date.getUTCFullYear(), m = date.getUTCMonth(), dd = date.getUTCDate();
    w = { start: local(y, m, dd, s.open, s.zone), end: local(y, m, dd, s.close, s.zone), day: date.toISOString().slice(0, 10) };
  }
  if (windowMemo.size > 20_000) windowMemo.clear();
  windowMemo.set(k, w);
  return w;
}

/** Each weekday's session window overlapping [from, to), epoch seconds. */
export function sessionWindows(s: MarketSession, from: number, to: number): Window[] {
  const out: Window[] = [];
  for (let d = Math.floor(from / DAY) - 1; d * DAY < to + DAY; d++) {
    const w = windowOn(s, d);
    if (w && w.end > from && w.start < to) out.push(w);
  }
  return out;
}

/** The next time this session opens, strictly after `t`. */
export function nextSessionOpen(s: MarketSession, t: number): number {
  for (let span = 3; ; span *= 2) {
    const next = sessionWindows(s, t, t + span * DAY).find((w) => w.start > t);
    if (next) return next.start;
  }
}

/** The next weekday's 00:00 UTC — the open of the next daily candle, as MT5 draws it. */
export function nextDayOpen(t: number): number {
  let d = Math.floor(t / DAY) + 1;
  while ([0, 6].includes(new Date(d * DAY * 1000).getUTCDay())) d++;
  return d * DAY;
}

/* ----------------------------------------------------------- random starts */

/** Where in a day a replay starts. */
export type StartWhen = "day" | "tokyo" | "london" | "newyork" | "random";

export const START_WHEN: { key: StartWhen; label: string }[] = [
  { key: "day", label: "Start of the day" },
  { key: "tokyo", label: "1 hour before Tokyo opens" },
  { key: "london", label: "1 hour before London opens" },
  { key: "newyork", label: "1 hour before New York opens" },
  { key: "random", label: "A random time" },
];

/**
 * The moment (epoch seconds) to start a replay on `day` (YYYY-MM-DD, a UTC
 * trading day): its 00:00 UTC open, an hour before one of the sessions opens
 * (daylight saving included, as the session boxes draw them), or a whole
 * minute picked at random between 00:05 and 20:30 UTC — inside the day and
 * clear of gold's daily break.
 */
export function startTimeFor(day: string, when: StartWhen, rand: () => number = Math.random): number {
  const d0 = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  if (when === "random") {
    const first = 5, last = 20 * 60 + 30; // minutes after 00:00 UTC
    return d0 + (first + Math.floor(rand() * (last - first + 1))) * 60;
  }
  if (when === "day") return d0;
  const s = SESSIONS.find((x) => x.id === when);
  const w = s ? windowOn(s, Math.floor(d0 / DAY)) : null;
  return w ? w.start - 3600 : d0;
}
