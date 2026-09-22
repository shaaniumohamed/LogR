"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { invites, tradeAnnotations, tradeScreenshots, tradingAccounts, tradingRules, users, weeklyNotes } from "@/lib/db/schema";
import { viewUrl } from "@/lib/storage";
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
    rulesBroken: form.getAll("rulesBroken").map(String),
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
        rulesBroken: values.rulesBroken,
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

/** Screenshots for one trade, with links that are signed fresh and expire. */
export async function loadScreenshots(accountId: string, identityHash: string) {
  return readOrDegrade(async () => {
    const rows = await db.select().from(tradeScreenshots)
      .where(and(
        eq(tradeScreenshots.accountId, accountId),
        eq(tradeScreenshots.identityHash, identityHash),
      ))
      .orderBy(tradeScreenshots.createdAt);
    return rows.map((r) => ({
      id: r.id,
      // Signed per render rather than stored: a link that lives in the database
      // is a link that outlives the reason it was created.
      url: viewUrl(r.storageKey),
      caption: r.caption,
      width: r.width,
      height: r.height,
    }));
  }, []);
}

/** The trader's own conclusions about a week. */
export async function loadWeeklyNote(accountId: string, weekStart: string) {
  return readOrDegrade(() => db.query.weeklyNotes.findFirst({
    where: and(eq(weeklyNotes.accountId, accountId), eq(weeklyNotes.weekStart, weekStart)),
  }), undefined);
}

/**
 * Saved as one row per week, replacing whatever was there.
 *
 * No history of edits: a weekly review is a conclusion, not a log, and anyone
 * revising last week's note is correcting it rather than adding to it.
 */
export async function saveWeeklyNote(weekStart: string, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { ok: false, error: "Not signed in" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, error: "Bad week" };

  const text = (k: string) => {
    const v = String(form.get(k) ?? "").trim().slice(0, 2000);
    return v === "" ? null : v;
  };
  const values = {
    accountId: ctx.account.id, userId: ctx.userId, weekStart,
    wentWell: text("wentWell"), toFix: text("toFix"), focus: text("focus"),
    updatedAt: new Date(),
  };

  await db.insert(weeklyNotes).values(values).onConflictDoUpdate({
    target: [weeklyNotes.accountId, weeklyNotes.weekStart],
    set: { wentWell: values.wentWell, toFix: values.toFix, focus: values.focus, updatedAt: values.updatedAt },
  });

  revalidatePath(`/week/${weekStart}`);
  return { ok: true };
}

/* --------------------------------------------------------------- rules */

export async function loadRules(accountId: string) {
  return readOrDegrade(
    () => db.select().from(tradingRules)
      .where(eq(tradingRules.accountId, accountId))
      .orderBy(tradingRules.sortOrder, tradingRules.createdAt),
    [],
  );
}

export async function addRule(_prev: { error?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const text = String(form.get("text") ?? "").trim().slice(0, 160);
  if (text.length < 4) return { error: "A rule needs to say something." };

  const existing = await loadRules(ctx.account.id);
  if (existing.length >= 20) {
    return { error: "Twenty rules is already more than anyone checks. Retire one first." };
  }
  if (existing.some((r) => r.text.toLowerCase() === text.toLowerCase())) {
    return { error: "That rule is already on the list." };
  }

  await db.insert(tradingRules).values({
    accountId: ctx.account.id, userId: ctx.userId, text,
    sortOrder: existing.length,
  });
  revalidatePath("/playbook");
  return {};
}

/**
 * Retiring a rule keeps it, and keeps it counting.
 *
 * The trades of last March were judged against the rules that were in force
 * last March, so deleting one would quietly rewrite that history. Retired rules
 * stop appearing on the form and stay in the figures.
 */
export async function setRuleActive(_prev: unknown, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const id = String(form.get("id") ?? "");
  const active = String(form.get("active") ?? "") === "true";
  await db.update(tradingRules).set({ active })
    .where(and(eq(tradingRules.id, id), eq(tradingRules.accountId, ctx.account.id)));
  revalidatePath("/playbook");
  return {};
}

/* ------------------------------------------------------------- accounts */

const KINDS = ["live", "demo", "cent", "prop"] as const;

/**
 * A second account is not a second journal.
 *
 * Trades, notes, rules and screenshots all hang off an account id, so switching
 * changes every figure in the app at once — which is the point. A demo run and
 * a live one averaged together produce a number that describes neither.
 */
export async function createAccount(_prev: { error?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const nickname = String(form.get("nickname") ?? "").trim().slice(0, 40);
  const broker = String(form.get("broker") ?? "").trim().slice(0, 40) || "Exness";
  const kindRaw = String(form.get("accountKind") ?? "live");
  const accountKind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "live";
  const currency = String(form.get("currency") ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";

  if (nickname.length < 1) return { error: "Give it a name you will recognise." };
  if (ctx.accounts.length >= 10) return { error: "Ten accounts is already a lot to keep straight." };
  if (ctx.accounts.some((a) => a.nickname.toLowerCase() === nickname.toLowerCase())) {
    return { error: "You already have an account with that name." };
  }

  const [created] = await db.insert(tradingAccounts).values({
    userId: ctx.userId, nickname, broker, currency, accountKind,
    // A cent account denominates in cents; the metrics work it out from the
    // fills either way, but the flag is what the label on screen reads from.
    isCent: accountKind === "cent",
  }).returning();

  // Switch to it: nobody adds an account in order to keep looking at another.
  await db.update(users).set({ activeAccountId: created.id }).where(eq(users.id, ctx.userId));
  revalidatePath("/", "layout");
  return {};
}

export async function switchAccount(_prev: unknown, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const id = String(form.get("accountId") ?? "");
  // Checked against the caller's own list, so an id from anywhere else is a
  // no-op rather than a way into somebody else's journal.
  if (!ctx.accounts.some((a) => a.id === id)) return { error: "No such account." };

  await db.update(users).set({ activeAccountId: id }).where(eq(users.id, ctx.userId));
  revalidatePath("/", "layout");
  return {};
}

export async function renameAccount(_prev: { error?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const id = String(form.get("accountId") ?? "");
  const nickname = String(form.get("nickname") ?? "").trim().slice(0, 40);
  if (!nickname) return { error: "A name cannot be empty." };
  if (!ctx.accounts.some((a) => a.id === id)) return { error: "No such account." };

  await db.update(tradingAccounts).set({ nickname })
    .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, ctx.userId)));
  revalidatePath("/", "layout");
  return {};
}

/**
 * Deleting an account destroys everything under it, so the name has to be typed.
 *
 * Trades cascade, and so do the notes, rules and screenshot records keyed to
 * them. That is the correct behaviour — an account you have removed should not
 * leave its numbers in your totals — and it is also unrecoverable, which is why
 * this asks for the one piece of confirmation a mis-tap cannot supply.
 */
export async function deleteAccount(_prev: { error?: string } | null, form: FormData) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return { error: "Not signed in" };

  const id = String(form.get("accountId") ?? "");
  const typed = String(form.get("confirm") ?? "").trim();
  const target = ctx.accounts.find((a) => a.id === id);

  if (!target) return { error: "No such account." };
  if (ctx.accounts.length === 1) return { error: "This is your only account, so there would be nothing left to sign in to." };
  if (typed.toLowerCase() !== target.nickname.toLowerCase()) {
    return { error: `Type “${target.nickname}” exactly to confirm.` };
  }

  await db.delete(tradingAccounts)
    .where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, ctx.userId)));

  const fallback = ctx.accounts.find((a) => a.id !== id)!;
  await db.update(users).set({ activeAccountId: fallback.id }).where(eq(users.id, ctx.userId));
  revalidatePath("/", "layout");
  return {};
}
