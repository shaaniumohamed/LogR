import { createHash, createHmac } from "node:crypto";

/**
 * Signature Version 4, by hand.
 *
 * The obvious alternative is the AWS SDK, and it is two megabytes to do
 * something that is four hashes and a string. On a serverless function that
 * weight is paid on every cold start, for one PUT and one signed link per
 * screenshot — so this is written out instead, and pinned by the signing
 * example AWS publishes so it cannot drift into being subtly wrong.
 *
 * Cloudflare R2 speaks the same protocol, which is the whole reason it is the
 * storage here: no lock-in, and the free tier holds ten gigabytes with no
 * charge for reading it back.
 */

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface SigningInput {
  method: string;
  /** Path only, already encoded, beginning with a slash. */
  path: string;
  host: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex sha256 of the body, or UNSIGNED_PAYLOAD. */
  payloadHash: string;
  /** Extra headers to sign. `host` is added automatically. */
  headers?: Record<string, string>;
  /** Query parameters, signed in the canonical order. */
  query?: Record<string, string>;
  /** Defaults to now. Present so the tests can pin a moment. */
  now?: Date;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Every byte outside the unreserved set is percent-encoded, and a slash in a
 * path stays a slash. Getting this wrong is the classic cause of a signature
 * that works until the first file with a space in its name.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else if (c === "/" && !encodeSlash) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query).sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
}

interface Canonical { canonicalRequest: string; stringToSign: string; signature: string; signedHeaders: string; amzDate: string; scope: string }

function sign(input: SigningInput, query: Record<string, string>, headers: Record<string, string>): Canonical {
  const now = input.now ?? new Date();
  const amzDate = stamp(now);
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;

  const all: Record<string, string> = { host: input.host, ...headers };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = names
    .map((n) => {
      const key = Object.keys(all).find((k) => k.toLowerCase() === n)!;
      return `${n}:${String(all[key]).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return { canonicalRequest, stringToSign, signature, signedHeaders, amzDate, scope };
}

/** Headers to send with a signed request, including Authorization. */
export function signedHeaders(input: SigningInput): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = stamp(now);
  const headers: Record<string, string> = {
    ...input.headers,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": input.payloadHash,
  };
  const r = sign({ ...input, now }, input.query ?? {}, headers);
  return {
    ...headers,
    host: input.host,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${r.scope}, ` +
      `SignedHeaders=${r.signedHeaders}, Signature=${r.signature}`,
  };
}

/**
 * A link that grants one operation on one object for a limited time.
 *
 * Used so screenshots can live in a bucket nobody can read — a trader's
 * chart mark-up is their own, and "the key is a random string so nobody will
 * guess it" is not the same as private.
 */
export function presignedUrl(input: SigningInput & { expiresIn: number }): string {
  const now = input.now ?? new Date();
  const amzDate = stamp(now);
  const day = amzDate.slice(0, 8);
  const query: Record<string, string> = {
    ...input.query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${day}/${input.region}/${input.service}/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const r = sign({ ...input, now, payloadHash: UNSIGNED_PAYLOAD }, query, {});
  const qs = canonicalQuery({ ...query, "X-Amz-Signature": r.signature });
  return `https://${input.host}${input.path}?${qs}`;
}

/** Exposed for the tests, which pin the intermediate strings and not just the digest. */
export const __internals = { sign, canonicalQuery, stamp, sha256hex };
