"use client";

import Link from "next/link";

/**
 * What a reader sees when a page throws.
 *
 * The default is a digest string and nothing else, which tells the person
 * looking at it precisely nothing and leaves them with no way forward. This at
 * least distinguishes "try again" from "something is genuinely broken", keeps
 * the rest of the app reachable, and prints the digest where it can be quoted
 * rather than hiding it in a server log nobody has access to from a phone.
 */
export default function AppError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card p-6 text-center">
      <h2 className="text-lg font-semibold">This screen didn&rsquo;t load</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        Your trades are safe — nothing here writes anything. This is usually a hiccup reaching
        the database, and trying again is normally enough.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold"
                style={{ background: "var(--ink)", color: "var(--plane)" }}>
          Try again
        </button>
        <Link href="/dashboard" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
          Back to overview
        </Link>
      </div>
      {error.digest && (
        <p className="num mt-5 text-[11px]" style={{ color: "var(--ink3)" }}>
          reference {error.digest}
        </p>
      )}
    </div>
  );
}
