import Link from "next/link";
import type { Leak } from "@/lib/core/leaks";
import { Info } from "@/components/info";
import { Icon } from "@/components/icons";
import { money, money0 } from "@/components/ui";

/**
 * The most expensive habits, most expensive first.
 *
 * Shaped like a list of findings rather than a chart, because each line is a
 * sentence about the trader ("Trading while rushed") with a price on it, and
 * the only comparison that matters is between the lines. Every row opens the
 * trades it is made of — a finding you cannot check is a finding you should
 * not act on.
 */
export function LeaksCard({ leaks, period, compact = false }: {
  leaks: Leak[];
  period: string;
  /** Home shows the top three; Insights shows the full list with the method. */
  compact?: boolean;
}) {
  const shown = compact ? leaks.slice(0, 3) : leaks;
  const top = Math.max(...shown.map((l) => l.cost), 1);

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: "color-mix(in srgb, var(--loss) 12%, transparent)", color: "var(--loss)" }}>
          <Icon name="leak" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight">Biggest leaks</h2>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            {shown.length
              ? "Habits that cost you more than the rest of your trading"
              : "Nothing here is costing you more than the rest of your trading"}
          </p>
        </div>
        {compact && shown.length > 0 && (
          <Link href={`/analytics?period=${period}`} className="tap -mr-2 shrink-0 rounded-lg px-2 text-[13px] font-semibold"
                style={{ color: "var(--c1)" }}>
            See all
          </Link>
        )}
      </div>

      {shown.length > 0 && (
        <ol className="mt-4 space-y-1">
          {shown.map((l) => {
            const href = l.filter ? `/trades?${new URLSearchParams({ period, ...l.filter }).toString()}` : null;
            const body = (
              <>
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug">{l.title}</span>
                  <span className="num shrink-0 text-[15px] font-semibold" style={{ color: "var(--loss)" }}>
                    {money0(-l.cost)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, (l.cost / top) * 100)}%`, background: "var(--loss)", opacity: 0.85 }} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: "var(--ink3)" }}>
                  <span className="num">{l.n} trades</span>
                  <span aria-hidden>·</span>
                  <span className="num">{money(l.groupAvg)} a trade, against {money(l.restAvg)} for the rest</span>
                  <span className={`chip ${l.strength === "clear" ? "chip-loss" : ""}`}>
                    {l.strength === "clear" ? "Clear pattern" : "Worth watching"}
                  </span>
                </div>
              </>
            );
            return (
              <li key={l.key}>
                {href
                  ? <Link href={href} className="row-link -mx-2 block rounded-xl px-2 py-2.5">{body}</Link>
                  : <div className="py-2.5">{body}</div>}
              </li>
            );
          })}
        </ol>
      )}

      {!compact && (
        <Info title="How a habit makes this list">
          Every habit the app can measure is tested at once — each hour and weekday, each feeling
          and mistake you have tagged, quick re-entries after a loss, carrying on after two losses,
          trading bigger than usual, news, the close, and more.
          <br /><br />
          A habit only appears if its trades lost money, did worse per trade than everything else
          you did, and by a margin too large to be luck. That last test matters most when an
          account is losing overall: without it, any big group of trades would look like a leak
          simply for being big.
          <br /><br />
          The amount is what you would have kept by not taking those trades. The rows overlap — a
          rushed trade at 04:00 sits in two of them — so they are never added together.
        </Info>
      )}
    </section>
  );
}
