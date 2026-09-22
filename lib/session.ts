import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { invites, tradingAccounts, users } from "@/lib/db/schema";
import { gateIsOpen, isOwner, normaliseEmail } from "@/lib/access";
import { readOrDegrade } from "@/lib/db/schema-check";

export interface RequestContext {
  userId: string;
  email: string | null;
  /** Every account this person has, oldest first. */
  accounts: (typeof tradingAccounts.$inferSelect)[];
  /** Every time in the UI renders in this zone. */
  timeZone: string;
  account: typeof tradingAccounts.$inferSelect;
  /** Named in the environment: may hand out and take back access. */
  isOwner: boolean;
  /** False once an invite has been revoked, while the session is still valid. */
  hasAccess: boolean;
}

/**
 * Who is asking, and which account — once per request, in one round trip.
 *
 * This exists because of where the app runs. Every query is an HTTPS call from
 * a Vercel function to Neon, and if those two sit on different continents each
 * one costs a couple of hundred milliseconds. The layout used to look the user
 * up, then the page looked the SAME user up again, then fetched the account
 * separately — three sequential crossings before a single trade had been read,
 * and the reader watching a blank screen pays for all of them.
 *
 * Two fixes, both here. The user row and the account row come back from one
 * statement instead of two. And React's `cache` makes the whole thing a
 * per-request singleton, so the layout and the page and anything else that asks
 * during the same render share the one answer.
 *
 * Deliberately NOT a cross-request cache: this is the authorisation boundary,
 * and a stale answer here would be a security bug rather than a slow page.
 */
export const requestContext = cache(async (): Promise<RequestContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  /*
   * Every account in the same statement as the user, rather than one row.
   *
   * A trader with a live account and a demo has two, and the page needs the
   * whole list anyway to offer the switch. Joining them is the same single
   * crossing it always was — a handful of rows, not a table scan.
   */
  const rows = await db
    .select({ timeZone: users.timeZone, email: users.email, active: users.activeAccountId, account: tradingAccounts })
    .from(users)
    .leftJoin(tradingAccounts, eq(tradingAccounts.userId, users.id))
    .where(eq(users.id, userId));

  const row = rows[0];
  if (!row) return null;

  const accounts = rows
    .map((r) => r.account)
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  /*
   * Revocation has to bite before the session expires.
   *
   * Sessions here are JWTs, which is what makes every page cheap — no database
   * round trip to know who is asking. The cost is that removing someone from
   * the list does nothing until their token runs out, which is weeks. So the
   * invite is re-checked here, in a query issued alongside the one above rather
   * than after it, which means it costs no extra waiting.
   *
   * Owners skip it: they are named in the environment and cannot be revoked
   * from inside the app, and checking would only add a way to lock them out.
   */
  const owner = isOwner(row.email);
  const hasAccess = owner || gateIsOpen()
    ? true
    : await readOrDegrade(async () => {
        if (!row.email) return false;
        const [invite] = await db.select({ email: invites.email }).from(invites)
          .where(eq(invites.email, normaliseEmail(row.email!))).limit(1);
        return !!invite;
      }, true);

  // First visit. One extra round trip, once in this user's lifetime.
  const created = accounts.length ? null : (await db
    .insert(tradingAccounts)
    .values({ userId, nickname: "Main", broker: "Exness", currency: "USD" })
    .returning())[0];
  if (created) accounts.push(created);

  // A stale or deleted id falls back to the oldest account rather than failing:
  // this is a preference, and being wrong about it should never lock anyone out.
  const account = accounts.find((a) => a.id === row.active) ?? accounts[0];

  return {
    userId,
    email: row.email,
    accounts,
    // UTC is the stored default and means "not set yet" rather than a choice.
    timeZone: row.timeZone && row.timeZone !== "UTC" ? row.timeZone : "UTC",
    account,
    isOwner: owner,
    hasAccess,
  };
});

/** For the handful of callers that cannot proceed without one. */
export async function requireContext(): Promise<RequestContext> {
  const ctx = await requestContext();
  if (!ctx) throw new Error("Not signed in");
  return ctx;
}
