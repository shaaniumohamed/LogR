import { NextResponse } from "next/server";
import { z } from "zod";
import { requestContext } from "@/lib/session";
import { payrollDates } from "@/lib/core/news";
import { clearDerived, saveEvents } from "@/lib/news";

export const runtime = "nodejs";
export const maxDuration = 30;

const Event = z.object({
  at: z.string(),
  currency: z.string().min(1).max(8),
  title: z.string().min(1).max(140),
  impact: z.enum(["high", "medium", "low"]),
});

const Body = z.union([
  z.object({ mode: z.literal("derive"), fromYear: z.number().int(), toYear: z.number().int() }),
  z.object({ mode: z.literal("import"), events: z.array(Event).min(1).max(20000) }),
]);

/**
 * Two ways in, and neither of them guesses.
 *
 * DERIVE computes the releases whose timing is a rule rather than a calendar
 * entry. Payrolls is the only major one that qualifies, and it is worth having
 * on its own: a feed tells you about the coming week, and every question this
 * app asks is about the past.
 *
 * IMPORT takes a calendar file the trader downloaded. The parsing happens in
 * their browser so this endpoint receives clean rows, which is the same
 * arrangement the trade import uses and for the same reason — a parser that
 * runs on the client never meets a request-size limit.
 */
export async function POST(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed request" }, { status: 400 });

  if (parsed.data.mode === "derive") {
    const { fromYear, toYear } = parsed.data;
    if (toYear < fromYear || toYear - fromYear > 30 || fromYear < 1990 || toYear > 2100) {
      return NextResponse.json({ error: "That is not a sensible range of years." }, { status: 400 });
    }
    /*
     * Cleared first so a fix to the rule replaces the old answers rather than
     * sitting beside them — but only by an owner.
     *
     * The calendar is shared, like the candles. Anyone may add to it, because
     * adding is additive and a release that happened happened. Wiping it is the
     * one action here that takes something away from other people, so it is
     * kept to the person who runs the journal. For everyone else the insert
     * simply skips what is already stored.
     */
    if (ctx.isOwner) await clearDerived();
    const stored = await saveEvents(payrollDates(fromYear, toYear));
    return NextResponse.json({ ok: true, stored, kind: "derived", replaced: ctx.isOwner });
  }

  const events = parsed.data.events.map((e) => ({
    at: new Date(e.at), currency: e.currency, title: e.title, impact: e.impact, source: "csv",
  })).filter((e) => !Number.isNaN(e.at.getTime()));

  if (!events.length) return NextResponse.json({ error: "No readable events" }, { status: 400 });
  const stored = await saveEvents(events);
  return NextResponse.json({ ok: true, stored, duplicates: events.length - stored, kind: "csv" });
}
