import { NextResponse } from "next/server";
import { schemaGaps } from "@/lib/db/schema-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Can this deployment reach its database, and is that database current?
 *
 * DELIBERATELY UNAUTHENTICATED, for one reason: the failure it diagnoses is one
 * that breaks signing in. A check you can only see once you are through the
 * door is no use when the door is what is broken — which is exactly the
 * situation that prompted it.
 *
 * What it can tell you is narrow on purpose. It answers which tables and
 * columns exist, and nothing else: no rows, no email addresses, no counts, no
 * connection string and no hostname. The list of table names is already public
 * — lib/db/schema.ts is in the repository — so naming them tells an outsider
 * nothing they could not read there, while telling the person who deployed it
 * the one thing they cannot otherwise find out from a phone: which database
 * this running app is actually talking to.
 *
 * That last point is the whole value. "I ran db:push and it did not help" is
 * almost always a migration applied to a different database than the one the
 * deployment uses, and there is no way to see that from the outside. Here the
 * answer comes from inside the running app, so it cannot be about the wrong
 * database.
 */
export async function GET() {
  const gaps = await schemaGaps();

  if (gaps === null) {
    return NextResponse.json(
      {
        ok: false,
        database: "unreachable",
        detail: "The app could not query the database at all. Check DATABASE_URL is set for this environment.",
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  if (gaps.length) {
    return NextResponse.json(
      {
        ok: false,
        database: "behind",
        missing: gaps,
        detail: "This database is older than the deployed code. Apply drizzle/schema.sql to it, or run npm run db:push against it.",
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json({ ok: true, database: "current" }, { headers: { "cache-control": "no-store" } });
}
