import Link from "next/link";

/**
 * What you get when you ask for something that is not there — including
 * something that belongs to somebody else.
 *
 * Deliberately the same page either way. A journal that said "you do not have
 * access to this trade" would be confirming that the trade exists, which is a
 * question no stranger should be able to ask. Not found and not yours look
 * identical from the outside.
 */
export default function NotFound() {
  return (
    <div className="card p-6 text-center">
      <h2 className="text-lg font-semibold">Nothing here</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        That page does not exist on your journal. If you followed a link from somewhere, it may
        point at a trade you have since re-imported — annotations survive that, but the address
        changes.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{ background: "var(--ink)", color: "var(--plane)" }}>
          Back to overview
        </Link>
        <Link href="/trades" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
          All trades
        </Link>
      </div>
    </div>
  );
}
