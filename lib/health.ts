import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface Health {
  /** Where the server code ran, as the host reports it. */
  region: string | null;
  /** Milliseconds for a trivial statement — almost entirely network. */
  dbMs: number | null;
  ok: boolean;
}

/**
 * How far the database is from the code.
 *
 * Every screen in this app is built per request and every figure on it comes
 * from a query, so the single biggest thing deciding whether a tap feels
 * instant or sluggish is the round trip between the serverless function and
 * Postgres. Colocated, that is a couple of milliseconds. On opposite sides of
 * the Pacific it is two or three hundred, and a page that needs three of them
 * is most of a second behind before it has drawn anything.
 *
 * That is invisible from the outside and unguessable from the inside, so it is
 * measured and shown. `select 1` does no work worth timing, which is the point:
 * what comes back is the distance, not the query.
 */
export async function checkHealth(): Promise<Health> {
  const region = process.env.VERCEL_REGION ?? null;
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return { region, dbMs: Date.now() - started, ok: true };
  } catch {
    return { region, dbMs: null, ok: false };
  }
}

/** Vercel's region codes are not self-explanatory on a phone. */
export const REGION_NAMES: Record<string, string> = {
  arn1: "Stockholm", bom1: "Mumbai", cdg1: "Paris", cle1: "Cleveland",
  cpt1: "Cape Town", dub1: "Dublin", fra1: "Frankfurt", gru1: "São Paulo",
  hkg1: "Hong Kong", hnd1: "Tokyo", iad1: "Washington DC", icn1: "Seoul",
  kix1: "Osaka", lhr1: "London", pdx1: "Portland", sfo1: "San Francisco",
  sin1: "Singapore", syd1: "Sydney",
};

export function regionName(code: string | null): string {
  if (!code) return "your own machine";
  return REGION_NAMES[code] ? `${REGION_NAMES[code]} (${code})` : code;
}

/**
 * Three bands, because the advice differs at each and a bare number does not
 * tell a reader whether to act.
 */
export function verdictFor(ms: number | null): { label: string; tone: "pos" | "warn" | "neg"; advice: string } {
  if (ms === null) {
    return { label: "unreachable", tone: "neg", advice: "The database did not answer at all." };
  }
  if (ms < 30) {
    return {
      label: "next door",
      tone: "pos",
      advice: "The database is close to the code. Nothing to fix here — anything still slow is elsewhere.",
    };
  }
  if (ms < 120) {
    return {
      label: "a room away",
      tone: "warn",
      advice: "Usable, but every screen pays this two or three times over. Worth checking that the app and the database are in the same region.",
    };
  }
  return {
    label: "a continent away",
    tone: "neg",
    advice: "This is the reason pages feel slow, and no amount of code tuning will fix it. The app and the database are in different parts of the world.",
  };
}
