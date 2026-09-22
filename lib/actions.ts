"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { invites, tradeAnnotations, users } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { isOwner, looksLikeEmail, normaliseEmail } from "@/lib/access";
import type { Drawing } from "@/lib/core/types";
import { getOrCreateAccount } from "@/lib/account";
import { readOrDegrade } from "@/lib/db/schema-check";

/**
 * Annotations are keyed to identityHash, never to a row id, so re-deriving zone
 * trades after a parser change cannot orphan anything the trader wrote.
 */
export async function saveAnnotation(identityHash: string, form: FormData) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Not signed in" };

  const account = await getOrCreateAccount(userId);
  const str = (k: string) => {
    const v = form.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
  const num = (k: string) => {
    const s = str(k);
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const values = {
    userId,
    accountId: account.id,
    identityHash,
    setup: str("setup"),
    timeframe: str("timeframe"),
    invalidation: num("invalidation"),
    invalidationSource: num("invalidation") === null ? null : "user",
    confluences: form.getAll("confluences").map(String),
    mistakes: form.getAll("mistakes").map(String),
    emotion: str("emotion"),
    note: str("note"),
    updatedAt: new Date(),
  };

  await db
    .insert(tradeAnnotations)
    .values(values)
    .onConflictDoUpdate({
      target: [tradeAnnotations.accountId, tradeAnnotations.identityHash],
      set: {
        setup: values.setup,
        timeframe: values.timeframe,
        invalidation: values.invalidation,
        invalidationSource: values.invalidationSource,
        confluences: values.confluences,
        mistakes: values.mistakes,
        emotion: values.emotion,
        note: values.note,
        updatedAt: values.updatedAt,
      },
    });

  revalidatePath("/trades");
  revalidatePath("/review");
  revalidatePath("/analytics");
  return { ok: true };
}

/**
 * Save what the trader marked on the chart.
 *
 * Separate from saveAnnotation because it is a different act at a different
 * moment: drawing happens while looking at the chart, the rest of the form is
 * filled in afterwards. Sharing one submit would mean either losing drawings
 * when the form is saved from a stale render, or forcing the trader to finish
 * the whole form before a zone they just drew is safe.
 *
 * Only the drawings column is written, so the two can never overwrite each other.
 */
export async function saveDrawings(identityHash: string, drawings: Drawing[]) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Not signed in" };
  const account = await getOrCreateAccount(userId);

  const clean = drawings.slice(0, 40).map((d) => ({
    id: String(d.id).slice(0, 40),
    kind: d.kind === "zone" ? ("zone" as const) : ("level" as const),
    low: Number(d.low),
    high: Number(d.high),
    label: String(d.label).slice(0, 40),
  })).filter((d) => Number.isFinite(d.low) && Number.isFinite(d.high));

  await db.insert(tradeAnnotations)
    .values({ userId, accountId: account.id, identityHash, drawings: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [tradeAnnotations.accountId, tradeAnnotations.identityHash],
      set: { drawings: clean, updatedAt: new Date() },
    });

  revalidatePath("/trades");
  return { ok: true };
}

export async function loadAnnotations(accountId: string) {
  return readOrDegrade(
    () => db.select().from(tradeAnnotations).where(eq(tradeAnnotations.accountId, accountId)),
    [],
  );
}

export async function loadAnnotation(accountId: string, identityHash: string) {
  return readOrDegrade(() => db.query.tradeAnnotations.findFirst({
    where: and(
      eq(tradeAnnotations.accountId, accountId),
      eq(tradeAnnotations.identityHash, identityHash)
    ),
  }), undefined);
}

/**
 * Save the trader's time zone.
 *
 * Every time in the app renders in this zone, so it decides what "21:00" means.
 * Called automatically the first time we can detect it, because a journal whose
 * clock silently defaults to UTC tells a Malaysian trader their worst hour is
 * 13:00 when they were actually trading at 21:00.
 */
export async function setTimeZone(tz: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return { ok: false };
  }
  await db.update(users).set({ timeZone: tz }).where(eq(users.id, userId));
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Invite someone, or take the invitation back.
 *
 * Both check ownership on the server rather than trusting that the button was
 * only rendered for owners. A server action is a public endpoint with a
 * guessable shape; hiding the control is presentation, not security.
 */
export async function inviteFriend(_prev: { error?: string; ok?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.isOwner) return { error: "Only an owner can invite people." };

  const email = normaliseEmail(String(form.get("email") ?? ""));
  const note = String(form.get("note") ?? "").trim().slice(0, 60) || null;

  if (!looksLikeEmail(email)) {
    return { error: "That does not look like an email address." };
  }
  if (isOwner(email)) {
    return { error: "That address is already an owner, so it can always sign in." };
  }

  await db.insert(invites)
    .values({ email, note, invitedBy: ctx.userId })
    // Re-inviting someone updates the note rather than failing, which is what
    // anyone typing the same address twice actually meant.
    .onConflictDoUpdate({ target: invites.email, set: { note } });

  revalidatePath("/settings");
  return { ok: `${email} can sign in now.` };
}

export async function revokeInvite(_prev: { error?: string; ok?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.isOwner) return { error: "Only an owner can remove people." };

  const email = normaliseEmail(String(form.get("email") ?? ""));
  if (!email) return { error: "No address given." };

  await db.delete(invites).where(eq(invites.email, email));
  revalidatePath("/settings");
  return { ok: `${email} can no longer sign in. Nothing of theirs was deleted.` };
}
