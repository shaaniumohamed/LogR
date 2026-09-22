import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tradeScreenshots, zoneTrades } from "@/lib/db/schema";
import { requestContext } from "@/lib/session";
import { StorageError, deleteObject, putObject, storageConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Compressed in the browser first, so anything larger has gone wrong. */
const MAX_BYTES = 3 * 1024 * 1024;
/** Enough to tell a story about one trade; past that it is an album. */
const MAX_PER_TRADE = 6;

const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

export async function POST(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!storageConfigured()) {
    return NextResponse.json({
      error: "Screenshot storage is not set up yet.",
      hint: "Create a Cloudflare R2 bucket, then set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in your host's environment variables.",
    }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const identityHash = String(form?.get("identityHash") ?? "");
  const caption = String(form?.get("caption") ?? "").trim().slice(0, 120) || null;

  if (!(file instanceof File) || !identityHash) {
    return NextResponse.json({ error: "Malformed upload" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "That is not an image this app can store." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({
      error: "That image is too large even after compression.",
      detail: `${(file.size / 1024 / 1024).toFixed(1)} MB, and the limit is 3 MB.`,
    }, { status: 413 });
  }

  /*
   * The trade has to be one of theirs.
   *
   * The identity hash arrives from the browser and is therefore a claim, not a
   * fact. Without this check anyone signed in could attach a picture to another
   * account's trade simply by knowing — or guessing — its hash.
   */
  const [owned] = await db.select({ h: zoneTrades.identityHash }).from(zoneTrades)
    .where(and(eq(zoneTrades.accountId, ctx.account.id), eq(zoneTrades.identityHash, identityHash)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "No such trade on this account." }, { status: 404 });

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tradeScreenshots)
    .where(and(eq(tradeScreenshots.accountId, ctx.account.id),
               eq(tradeScreenshots.identityHash, identityHash)));
  if (n >= MAX_PER_TRADE) {
    return NextResponse.json({
      error: `That trade already has ${MAX_PER_TRADE} screenshots.`,
      detail: "Remove one before adding another.",
    }, { status: 409 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
  // Namespaced by account so one prefix is one trader, which makes a bucket
  // readable by a human and a future per-account deletion a single sweep.
  const key = `shots/${ctx.account.id}/${identityHash}/${crypto.randomUUID()}.${ext}`;
  const body = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, body, file.type);
  } catch (e) {
    const message = e instanceof StorageError ? e.message : "Could not reach storage.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const width = Number(form?.get("width")) || null;
  const height = Number(form?.get("height")) || null;

  const [row] = await db.insert(tradeScreenshots).values({
    userId: ctx.userId, accountId: ctx.account.id, identityHash,
    storageKey: key, contentType: file.type, bytes: body.length,
    width, height, caption,
  }).returning();

  return NextResponse.json({ ok: true, id: row.id });
}

export async function DELETE(req: Request) {
  const ctx = await requestContext();
  if (!ctx?.hasAccess) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "No id given" }, { status: 400 });

  // Scoped to the account in the WHERE clause rather than checked afterwards,
  // so there is no window in which the wrong row could be removed.
  const [row] = await db.delete(tradeScreenshots)
    .where(and(eq(tradeScreenshots.id, id), eq(tradeScreenshots.accountId, ctx.account.id)))
    .returning({ storageKey: tradeScreenshots.storageKey });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The row is the index; losing the object without it would leave a file
  // nothing points at, which is the harmless direction to fail in.
  await deleteObject(row.storageKey);
  return NextResponse.json({ ok: true });
}
