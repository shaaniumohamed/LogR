import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, users } from "@/lib/db/schema";
import { readOrDegrade } from "@/lib/db/schema-check";

/**
 * Who may use this journal.
 *
 * Two lists, deliberately different in kind.
 *
 * OWNERS live in the environment. They are the people who can hand out access,
 * they cannot be removed from inside the app, and they are the answer to the
 * bootstrapping problem — the first person to sign in has to be allowed in by
 * something that predates the database.
 *
 * INVITES live in the database, so adding a friend is a text field and a button
 * rather than an environment variable and a redeploy. That matters more than it
 * sounds: a gate that is annoying to open is a gate that ends up propped open.
 *
 * With both lists empty the app is open to any Google account. That is the
 * right behaviour for a fresh clone running on somebody's laptop and the wrong
 * one for a deployment, which is why the settings screen says so in as many
 * words when it happens.
 */

export const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? process.env.ALLOWED_EMAILS ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const normaliseEmail = (raw: string) => raw.trim().toLowerCase();

export const isOwner = (email: string | null | undefined): boolean =>
  !!email && OWNER_EMAILS.includes(normaliseEmail(email));

/** A gate with nothing behind it is not a gate; say so rather than pretending. */
export const gateIsOpen = () => OWNER_EMAILS.length === 0;

/**
 * May this address sign in?
 *
 * Called from the sign-in callback, so once per sign-in rather than per request.
 * Degrades to the environment list alone if the invite table is not there yet,
 * which keeps a deployment that is ahead of its migration usable by its owner
 * instead of locking everyone out — including the person who would run it.
 */
export async function canSignIn(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (gateIsOpen()) return true;
  if (isOwner(email)) return true;

  return readOrDegrade(async () => {
    const [row] = await db.select({ email: invites.email }).from(invites)
      .where(eq(invites.email, normaliseEmail(email))).limit(1);
    return !!row;
  }, false);
}

export interface Invite {
  email: string;
  note: string | null;
  createdAt: Date;
  invitedByName: string | null;
  /** Whether they have actually signed in yet. */
  joined: boolean;
}

export async function listInvites(): Promise<Invite[]> {
  return readOrDegrade(async () => {
    const inviter = db.select().from(users).as("inviter");
    const rows = await db
      .select({
        email: invites.email,
        note: invites.note,
        createdAt: invites.createdAt,
        invitedByName: inviter.name,
        joined: sql<boolean>`exists (select 1 from "user" u where lower(u.email) = ${invites.email})`,
      })
      .from(invites)
      .leftJoin(inviter, eq(inviter.id, invites.invitedBy))
      .orderBy(invites.createdAt);
    return rows.map((r) => ({ ...r, joined: !!r.joined }));
  }, []);
}

/** Anything that is not plausibly an email is a typo, and a typo is a locked-out friend. */
export function looksLikeEmail(raw: string): boolean {
  const e = normaliseEmail(raw);
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}
