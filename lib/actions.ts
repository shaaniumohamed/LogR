"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { tradeAnnotations, users } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";

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

export async function loadAnnotations(accountId: string) {
  return db.select().from(tradeAnnotations).where(eq(tradeAnnotations.accountId, accountId));
}

export async function loadAnnotation(accountId: string, identityHash: string) {
  return db.query.tradeAnnotations.findFirst({
    where: and(
      eq(tradeAnnotations.accountId, accountId),
      eq(tradeAnnotations.identityHash, identityHash)
    ),
  });
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
