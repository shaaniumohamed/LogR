import { createHash } from "node:crypto";
import { UNSIGNED_PAYLOAD, presignedUrl, signedHeaders, uriEncode } from "@/lib/core/s3-sign";

/**
 * Object storage for the one thing the broker cannot export: what the trader
 * was actually looking at.
 *
 * Cloudflare R2, because it speaks S3 and charges nothing to read data back.
 * That second part decides it: a journal shows the same screenshot every time
 * the trade is opened, so egress is the cost that would actually accumulate,
 * and on S3 proper it is the cost nobody notices until the bill. Ten gigabytes
 * free is somewhere around fifty thousand compressed chart screenshots.
 *
 * Everything here degrades to "not configured" rather than throwing, so the app
 * runs perfectly well with no storage at all and simply does not offer the
 * feature — the same way it behaves without a price-service key.
 */

const ACCOUNT = process.env.R2_ACCOUNT_ID ?? "";
const KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const SECRET = process.env.R2_SECRET_ACCESS_KEY ?? "";
const BUCKET = process.env.R2_BUCKET ?? "";

export const storageConfigured = () => !!(ACCOUNT && KEY_ID && SECRET && BUCKET);

const host = () => `${ACCOUNT}.r2.cloudflarestorage.com`;
// R2 has no regions, but the protocol demands one and documents this value.
const REGION = "auto";
const pathFor = (key: string) => `/${uriEncode(BUCKET, false)}/${uriEncode(key, false)}`;

const base = () => ({
  host: host(), region: REGION, service: "s3",
  accessKeyId: KEY_ID, secretAccessKey: SECRET,
});

export class StorageError extends Error {}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!storageConfigured()) throw new StorageError("Storage is not configured.");
  const path = pathFor(key);
  const headers = signedHeaders({
    ...base(), method: "PUT", path,
    payloadHash: createHash("sha256").update(body).digest("hex"),
    headers: { "content-type": contentType, "content-length": String(body.length) },
  });

  const res = await fetch(`https://${host()}${path}`, {
    method: "PUT", body: new Uint8Array(body), headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // The body carries the provider's own XML explanation, which is far more
    // useful than "500" when a key or a bucket name is wrong.
    throw new StorageError(`Storage refused the upload (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!storageConfigured()) return;
  const path = pathFor(key);
  const headers = signedHeaders({
    ...base(), method: "DELETE", path,
    payloadHash: createHash("sha256").update("").digest("hex"),
  });
  await fetch(`https://${host()}${path}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) })
    .catch(() => undefined);
}

/**
 * A link that works for an hour and then stops.
 *
 * The bucket is private, so this is the only way in. An unguessable key in a
 * public bucket would be simpler and is not the same as private: it survives
 * being pasted into a chat, a browser history, or anything that logs URLs.
 */
export function viewUrl(key: string, expiresIn = 3600): string {
  if (!storageConfigured()) return "";
  return presignedUrl({
    ...base(), method: "GET", path: pathFor(key),
    payloadHash: UNSIGNED_PAYLOAD, expiresIn,
  });
}
