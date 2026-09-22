/**
 * What to show when the database is older than the code.
 *
 * Two shapes of the same fact, because there are two severities. If the journal
 * still renders, a banner above it is enough and getting in the way would be
 * rude. If the gap is in something every page needs — the user row itself —
 * there is nothing to put a banner on top of, and the screen has to say so
 * instead of handing over a blank page and a number.
 */

/** Named so a reader can see whether their own trades are involved. */
function Missing({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <div className="num mt-3 rounded-lg p-2.5 text-[12px] leading-relaxed"
         style={{ background: "var(--s3)", color: "var(--ink2)" }}>
      {missing.join("  ·  ")}
    </div>
  );
}

function Fix() {
  return (
    <>
      <p className="mt-4 text-[13px] font-semibold">From a phone</p>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        Open your project on console.neon.tech, choose <strong>SQL Editor</strong>, paste the whole
        of <span className="num">drizzle/schema.sql</span> from the repository, and run it.
      </p>
      <p className="mt-4 text-[13px] font-semibold">From a computer</p>
      <code className="num mt-1 block rounded-lg p-2.5 text-[12px]" style={{ background: "var(--s3)" }}>
        git pull &amp;&amp; npm run db:push
      </code>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--ink3)" }}>
        Either way it has to reach <em>this</em> deployment&rsquo;s database. If you have run it
        already and nothing changed, it went to a different one — open
        <span className="num"> /api/health</span> here to see what this app can actually see.
        No redeploy needed; reload once it is done.
      </p>
    </>
  );
}

/** The journal still works. Say what is switched off and carry on. */
export function SchemaGapBanner({ missing }: { missing: string[] }) {
  return (
    <div className="card mb-4 p-4" style={{ borderColor: "var(--warn)" }}>
      <div className="eyebrow" style={{ color: "var(--warn)" }}>Database is behind the app</div>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        Your trades are safe and everything below still works. The parts that need what is
        missing — chart mark-up, price history, screenshots, rules — are switched off until
        the database catches up.
      </p>
      <Missing missing={missing} />
      <details className="mt-3">
        <summary className="tap cursor-pointer text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
          How to fix it
        </summary>
        <Fix />
      </details>
    </div>
  );
}

/** Nothing works. This is the whole page. */
export function SchemaGapScreen({ missing }: { missing: string[] }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6">
        <div className="eyebrow" style={{ color: "var(--warn)" }}>Database is behind the app</div>
        <h1 className="mt-2 text-lg font-semibold">LogR can&rsquo;t read your account yet</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
          The app has been updated and the database it talks to has not caught up, so the row
          that says who you are cannot be read. <strong>Nothing has been lost</strong> — no trade,
          note or screenshot is deleted by this, and they all come back the moment the tables
          below exist.
        </p>
        <Missing missing={missing} />
        <Fix />
      </div>
    </div>
  );
}
