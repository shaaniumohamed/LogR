import { describe, expect, it } from "vitest";
import { __internals, presignedUrl, signedHeaders, uriEncode } from "../lib/core/s3-sign";

/**
 * AWS publishes a worked example for Signature Version 4. Pinning the
 * intermediate strings as well as the final digest matters: a signature that
 * disagrees tells you only that something is wrong, whereas a canonical request
 * that disagrees tells you exactly which rule was broken.
 */
const EXAMPLE = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  host: "example.amazonaws.com",
  now: new Date("2015-08-30T12:36:00Z"),
};

describe("uriEncode", () => {
  it("leaves the unreserved set alone", () => {
    expect(uriEncode("abcXYZ019-._~")).toBe("abcXYZ019-._~");
  });

  it("encodes a space as %20 rather than a plus", () => {
    expect(uriEncode("a b")).toBe("a%20b");
  });

  it("can keep the slashes in a path", () => {
    expect(uriEncode("/a/b c", false)).toBe("/a/b%20c");
    expect(uriEncode("/a/b", true)).toBe("%2Fa%2Fb");
  });

  it("encodes bytes, not characters", () => {
    // Two bytes for the pound sign, both encoded.
    expect(uriEncode("£")).toBe("%C2%A3");
  });
});

describe("canonical form", () => {
  it("matches the published canonical request for a bare GET", () => {
    const r = __internals.sign(
      { method: "GET", path: "/", payloadHash: __internals.sha256hex(""), ...EXAMPLE },
      {},
      { "x-amz-date": "20150830T123600Z" },
    );
    expect(r.canonicalRequest).toBe(
      "GET\n" +
      "/\n" +
      "\n" +
      "host:example.amazonaws.com\n" +
      "x-amz-date:20150830T123600Z\n" +
      "\n" +
      "host;x-amz-date\n" +
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(r.stringToSign).toBe(
      "AWS4-HMAC-SHA256\n" +
      "20150830T123600Z\n" +
      "20150830/us-east-1/service/aws4_request\n" +
      // sha256 of the canonical request above, checked with sha256sum rather
      // than copied from anywhere.
      "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    );
    // AWS's published signature for this example, and the end of the chain:
    // if this holds, the key derivation and the final HMAC are both right.
    expect(r.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  it("sorts query parameters by name, as the canonical form requires", () => {
    expect(__internals.canonicalQuery({ b: "2", a: "1", A: "0" })).toBe("A=0&a=1&b=2");
  });

  it("sorts and lowercases the header names it signs", () => {
    const r = __internals.sign(
      { method: "PUT", path: "/x", payloadHash: "UNSIGNED-PAYLOAD", ...EXAMPLE },
      {},
      { "Content-Type": "image/webp", "X-Amz-Date": "20150830T123600Z" },
    );
    expect(r.signedHeaders).toBe("content-type;host;x-amz-date");
  });
});

describe("signedHeaders", () => {
  it("produces an Authorization header naming exactly what it signed", () => {
    const h = signedHeaders({
      method: "PUT", path: "/bucket/key.webp",
      payloadHash: __internals.sha256hex("hello"),
      headers: { "content-type": "image/webp" },
      ...EXAMPLE,
    });
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, /);
    expect(h.Authorization).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(h.Authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(h["x-amz-content-sha256"]).toBe(__internals.sha256hex("hello"));
  });

  it("never puts the secret anywhere in its output", () => {
    const h = signedHeaders({
      method: "GET", path: "/", payloadHash: __internals.sha256hex(""), ...EXAMPLE,
    });
    expect(JSON.stringify(h)).not.toContain(EXAMPLE.secretAccessKey);
  });
});

describe("presignedUrl", () => {
  const url = presignedUrl({
    method: "GET", path: "/bucket/a%20b.webp", payloadHash: "UNSIGNED-PAYLOAD",
    expiresIn: 3600, ...EXAMPLE,
  });

  it("carries every parameter the protocol requires", () => {
    const u = new URL(url);
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get("X-Amz-Credential")).toBe(
      "AKIDEXAMPLE/20150830/us-east-1/service/aws4_request");
  });

  it("is deterministic for the same moment and different for another", () => {
    const same = presignedUrl({
      method: "GET", path: "/bucket/a%20b.webp", payloadHash: "UNSIGNED-PAYLOAD",
      expiresIn: 3600, ...EXAMPLE,
    });
    const later = presignedUrl({
      method: "GET", path: "/bucket/a%20b.webp", payloadHash: "UNSIGNED-PAYLOAD",
      expiresIn: 3600, ...EXAMPLE, now: new Date("2015-08-30T12:37:00Z"),
    });
    expect(same).toBe(url);
    expect(later).not.toBe(url);
  });

  it("does not leak the secret into the link", () => {
    expect(url).not.toContain(EXAMPLE.secretAccessKey);
    expect(url).not.toContain("wJalrXUtnFEMI");
  });
});
