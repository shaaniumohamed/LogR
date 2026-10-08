/**
 * Which file a moment in time lives in.
 *
 * Ticks are filed by UTC day, M1 bars by month, H1 and D1 bars by year
 * (docs/30-backtesting.md). Everything here is UTC: a file boundary that moved
 * with the reader's time zone would put the same tick in two files.
 */

export type Resolution = "tick" | "m1" | "h1" | "d1";
export const RESOLUTIONS: Resolution[] = ["tick", "m1", "h1", "d1"];

/** Seconds per bar for the bar resolutions. */
export const BAR_SECONDS: Record<Exclude<Resolution, "tick">, number> = { m1: 60, h1: 3_600, d1: 86_400 };

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** The period a moment (epoch seconds) belongs to at a resolution. */
export function periodOf(resolution: Resolution, sec: number): string {
  const s = iso(sec);
  if (resolution === "tick") return s.slice(0, 10);
  if (resolution === "m1") return s.slice(0, 7);
  return s.slice(0, 4);
}

const PATTERN: Record<Resolution, RegExp> = {
  tick: /^\d{4}-\d{2}-\d{2}$/,
  m1: /^\d{4}-\d{2}$/,
  h1: /^\d{4}$/,
  d1: /^\d{4}$/,
};

/** First second of a period, or NaN if it is not a real one. */
export function periodStart(resolution: Resolution, period: string): number {
  if (!PATTERN[resolution].test(period)) return NaN;
  const [y, m = 1, d = 1] = period.split("-").map(Number);
  if (y < 1990 || y > 2100 || m < 1 || m > 12) return NaN;
  const t = Date.UTC(y, m - 1, d);
  // Rejects 2025-02-30 and friends: the date must survive the round trip.
  if (resolution === "tick" && new Date(t).toISOString().slice(0, 10) !== period) return NaN;
  return t / 1000;
}

/** First second after a period. */
export function periodEnd(resolution: Resolution, period: string): number {
  const s = periodStart(resolution, period);
  if (Number.isNaN(s)) return NaN;
  const d = new Date(s * 1000);
  if (resolution === "tick") d.setUTCDate(d.getUTCDate() + 1);
  else if (resolution === "m1") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime() / 1000;
}

export const isPeriod = (resolution: Resolution, period: string) => !Number.isNaN(periodStart(resolution, period));

/** Every period overlapping [from, to) seconds, in order. */
export function periodsBetween(resolution: Resolution, from: number, to: number): string[] {
  const out: string[] = [];
  if (!(to > from)) return out;
  let p = periodOf(resolution, from);
  for (let guard = 0; guard < 100_000; guard++) {
    out.push(p);
    const end = periodEnd(resolution, p);
    if (end >= to) break;
    p = periodOf(resolution, end);
  }
  return out;
}

/**
 * Where a file lives in the bucket. The content hash is part of the name, so a
 * re-import writes beside the old file instead of over it (see market_chunk).
 */
export function chunkKey(symbol: string, resolution: Resolution, period: string, sha256: string): string {
  const year = period.slice(0, 4);
  const ext = resolution === "tick" ? "lgrt" : "lgrb";
  return `market/v1/${symbol}/${resolution}/${year}/${period}-${sha256.slice(0, 16)}.${ext}.gz`;
}
