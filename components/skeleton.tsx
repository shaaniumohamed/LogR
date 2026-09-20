/**
 * Placeholders shown while a page is being built on the server.
 *
 * Every screen in this app is rendered per request — it has to be, the numbers
 * are the trader's own and change with every import — so a tap is always a round
 * trip. Without a placeholder the browser simply sits on the old page until the
 * new one arrives, which reads as the app having ignored the tap, and the
 * instinct is to tap again.
 *
 * These cost nothing and change the feel completely: the response is immediate
 * and the shape that appears is the shape that is coming, so the eye is already
 * in the right place when the real numbers land. The skeletons deliberately
 * mirror each page's actual layout rather than being one generic grey box —
 * a placeholder that resolves into something differently shaped is its own
 * small jolt.
 */

export function Bar({ w = "100%", h = 12, r = 6 }: { w?: string; h?: number; r?: number }) {
  return (
    <span className="block animate-pulse"
          style={{ width: w, height: h, borderRadius: r, background: "var(--s3)" }} />
  );
}

export function SkeletonCard({ children }: { children?: React.ReactNode }) {
  return <section className="card space-y-3 p-5">{children}</section>;
}

/** A headline card: eyebrow, a sentence, a big number. */
export function SkeletonHeadline() {
  return (
    <SkeletonCard>
      <Bar w="35%" h={9} />
      <Bar w="88%" h={14} />
      <Bar w="52%" h={30} />
    </SkeletonCard>
  );
}

export function SkeletonStats({ cols = 4 }: { cols?: 2 | 3 | 4 }) {
  const c = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  return (
    <div className={`grid ${c} gap-px overflow-hidden rounded-xl`}
         style={{ background: "var(--line)", border: "1px solid var(--line)" }}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="space-y-2 p-4" style={{ background: "var(--s1)" }}>
          <Bar w="60%" h={18} />
          <Bar w="80%" h={9} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonBars({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonCard>
      <Bar w="30%" h={9} />
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-[32%] shrink-0"><Bar w="80%" h={11} /></div>
            <div className="flex-1"><Bar w={`${88 - i * 13}%`} h={14} /></div>
            <div className="w-[64px] shrink-0"><Bar w="100%" h={11} /></div>
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <section className="card p-0">
      <ul>
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
            <Bar w="4px" h={28} r={2} />
            <div className="flex-1 space-y-1.5">
              <Bar w="46%" h={12} />
              <Bar w="72%" h={9} />
            </div>
            <div className="w-[68px]"><Bar w="100%" h={13} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SkeletonChart({ h = 200 }: { h?: number }) {
  return (
    <SkeletonCard>
      <Bar w="30%" h={9} />
      <Bar w="100%" h={h} r={10} />
    </SkeletonCard>
  );
}

export function SkeletonGrid() {
  return (
    <SkeletonCard>
      <div className="flex items-center justify-between">
        <Bar w="36px" h={32} r={8} />
        <Bar w="42%" h={16} />
        <Bar w="36px" h={32} r={8} />
      </div>
      <div className="grid gap-1 pt-2" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr)) 40px" }}>
        {Array.from({ length: 48 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg" style={{ background: "var(--s3)" }} />
        ))}
      </div>
    </SkeletonCard>
  );
}

/** The chip row that sits above most lists. */
export function SkeletonControls() {
  return (
    <div className="flex items-center justify-between gap-3">
      <Bar w="180px" h={30} r={8} />
      <Bar w="72px" h={12} />
    </div>
  );
}
