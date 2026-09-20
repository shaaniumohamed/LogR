import type { Candle } from "./parse-candles";
import { normalizeSymbol } from "./symbols";

/**
 * Twelve Data as a candle source.
 *
 * Chosen over the alternatives on one criterion: a free tier that actually
 * covers spot gold at one-minute resolution without a card. Alpha Vantage caps
 * at 25 calls a day and has no XAU pair; Finnhub puts forex candles behind a
 * paid plan; Yahoo only has the gold FUTURE, which trades at a different price
 * from spot and so would never line up with an Exness fill.
 *
 * The HTTP call lives in the route. Everything here is pure, so the response
 * handling — which is where a provider integration actually breaks — is covered
 * by tests rather than by hoping.
 */

export const TWELVEDATA_BASE = "https://api.twelvedata.com/time_series";

/** Free plan: 8 calls a minute, 800 a day. One call returns at most 5000 bars. */
export const RATE = { perMinute: 8, perDay: 800, maxBars: 5000 };

/**
 * Broker ticker → provider ticker.
 *
 * Twelve Data writes pairs with a slash: XAUUSD is XAU/USD. Six alphanumerics
 * split three-and-three covers every metal and FX pair; anything else is passed
 * through untouched, so an index ticker fails loudly at the provider rather than
 * being silently mangled here.
 */
export function providerSymbol(symbol: string): string {
  const s = normalizeSymbol(symbol);
  return /^[A-Z]{6}$/.test(s) ? `${s.slice(0, 3)}/${s.slice(3)}` : s;
}

/**
 * The documented datetime format: `2006-01-02T15:04:05`.
 *
 * The T is kept rather than swapped for a space. A space may well be accepted
 * too, but only the T form appears in the provider's parameter reference, and
 * an undocumented spelling is a thing that works until the day it does not.
 */
function apiStamp(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * The API key travels in a header, not the query string.
 *
 * The provider documents this as the preferred method and it is the safer one:
 * a URL ends up in error messages, proxy logs and stack traces by default,
 * whereas a header has to be deliberately printed to leak.
 */
export function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `apikey ${apiKey}`, accept: "application/json" };
}

/**
 * `interval` defaults to one minute, which is what the per-day backfill wants.
 *
 * The dates are optional because the higher timeframes are asked for
 * differently: one call with no range returns the most recent five thousand
 * bars, which at four hours is two years and at a day is thirteen. Naming a
 * range there would be pure arithmetic with nothing gained.
 */
export function buildUrl(
  { symbol, from, to, interval = "1min", outputsize = RATE.maxBars }:
  { symbol: string; from?: Date; to?: Date; interval?: string; outputsize?: number },
): string {
  const q = new URLSearchParams({
    symbol: providerSymbol(symbol),
    interval,
    // Without this the provider answers in the exchange's own zone, which would
    // reintroduce exactly the timezone bug the CSV path goes to such lengths to
    // catch. Asking for UTC means the answer needs no interpretation.
    timezone: "UTC",
    outputsize: String(outputsize),
    format: "JSON",
  });
  if (from) q.set("start_date", apiStamp(from));
  if (to) q.set("end_date", apiStamp(to));
  return `${TWELVEDATA_BASE}?${q}`;
}

export class ProviderError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
};

/** `2026-09-18 14:30:00` (UTC, as requested) or an ISO string. */
function stamp(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0)) / 1000;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

/**
 * Turn whatever came back into candles, or throw something a human can act on.
 *
 * Written defensively on purpose. A provider's error responses are the part of
 * its contract that is least documented and most likely to change, and an
 * integration that reports "Cannot read properties of undefined" when the real
 * answer is "you have used your 800 calls for today" wastes an evening. So the
 * provider's own message is passed through whenever there is one, and an
 * unrecognised body is quoted rather than summarised.
 */
export function normalise(body: unknown): Candle[] {
  if (!body || typeof body !== "object") {
    throw new ProviderError("The price service returned something that was not JSON.");
  }
  const b = body as Record<string, unknown>;

  if (b.status === "error" || (typeof b.code === "number" && b.code >= 400)) {
    const code = typeof b.code === "number" ? b.code : undefined;
    throw new ProviderError(String(b.message ?? "The price service refused the request."), code);
  }

  const values = b.values;
  if (!Array.isArray(values)) {
    throw new ProviderError(
      `Unexpected reply from the price service: ${JSON.stringify(b).slice(0, 200)}`,
    );
  }

  const candles: Candle[] = [];
  for (const row of values) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const time = stamp(r.datetime ?? r.timestamp ?? r.date);
    const open = num(r.open), high = num(r.high), low = num(r.low), close = num(r.close);
    if (time === null || [open, high, low, close].some(Number.isNaN) || high < low) continue;
    candles.push({ time, open, high, low, close });
  }

  if (!candles.length) {
    throw new ProviderError("The price service returned no candles for that period.");
  }
  // The API answers newest-first; everything downstream assumes oldest-first.
  candles.sort((a, b2) => a.time - b2.time);
  return candles;
}
