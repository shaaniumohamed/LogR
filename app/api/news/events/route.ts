import { NextResponse } from "next/server";
import { requestContext } from "@/lib/session";
import { loadEvents } from "@/lib/news";

export const runtime = "nodejs";

/** At most this much calendar per request: a replay asks a few weeks at a time. */
const MAX_DAYS = 120;

/**
 * Economic releases in a span, for the markers on a replay chart and the
 * "next news" jump. The calendar is the same for everyone, so any signed-in
 * user may read it.
 */
export async function GET(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const from = Number(q.get("from")), to = Number(q.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_DAYS * 86_400) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const events = await loadEvents(new Date(from * 1000), new Date(to * 1000));
  return NextResponse.json({
    events: events.map((e) => ({ at: Math.floor(e.at.getTime() / 1000), currency: e.currency, title: e.title, impact: e.impact })),
  }, { headers: { "Cache-Control": "private, max-age=300" } });
}
