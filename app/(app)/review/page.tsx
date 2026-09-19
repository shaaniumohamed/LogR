import Link from "next/link";
import { loadAnnotations } from "@/lib/actions";
import { loadTrades } from "@/lib/queries";
import { Card, Empty, Eyebrow, Note, Verdict, count, money } from "@/components/ui";
import { Info } from "@/components/info";

export const dynamic = "force-dynamic";

export default async function Review() {
  const { all, account, timeZone, isEmpty } = await loadTrades("all");
  if (isEmpty) return <Empty title="Nothing to review" body="Import your trade history first." />;

  const annotations = await loadAnnotations(account.id);
  const done = new Set(annotations.map((a) => a.identityHash));
  const pending = all.filter((t) => !done.has(t.id));

  /**
   * Biggest absolute result first, not newest first.
   *
   * With hundreds of untagged trades, asking the trader to work through them in
   * date order guarantees they stop before reaching anything that matters. The
   * largest winners and losers carry nearly all the explanatory signal, so
   * twenty annotations at the top of this list are worth two hundred at random.
   */
  const queue = [...pending].sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl));
  const top = queue.slice(0, 25);

  const pctDone = all.length ? done.size / all.length : 0;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  return (
    <div className="space-y-4">
      <Card>
        <Eyebrow>Annotation progress</Eyebrow>
        <Verdict>
          {done.size === 0
            ? `None of your ${all.length} trades are annotated yet. You do not need to do them all.`
            : `${done.size} of ${all.length} trades annotated.`}
        </Verdict>
        <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, pctDone * 100)}%`, background: "var(--profit)" }} />
        </div>
        <Info title="Why not annotate everything?">
          Your biggest winners and losers explain most of what happened; the hundreds of
          near-scratch trades in the middle mostly add noise. This queue is sorted by size of
          result rather than by date, so the twenty at the top are worth more than two hundred
          picked at random.
          <br /><br />
          Annotating unlocks three things the import cannot give you on its own: <b>R</b>, which
          needs the price where your idea was dead; <b>which setups actually pay</b>; and
          <b> how your state of mind maps to your results</b>.
        </Info>
      </Card>

      {top.length === 0 ? (
        <Empty title="All caught up" body="Every trade has been annotated. New imports will appear here." />
      ) : (
        <Card className="!p-0">
          <div className="px-4 pt-4">
            <Eyebrow>Worth annotating first</Eyebrow>
            <Note>Your largest results, biggest first. Each takes under a minute.</Note>
          </div>
          <ul className="mt-3">
            {top.map((t, i) => (
              <li key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                <Link href={`/trades/${t.id}?from=review`} className="flex items-center gap-3 px-4 py-3">
                  <span className="num w-5 shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{i + 1}</span>
                  <span className="h-7 w-1 shrink-0 rounded-full"
                        style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">
                      {t.direction === "long" ? "Bought" : "Sold"} {t.symbol}
                    </div>
                    <div className="num truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                      {fmt.format(t.openedAt)} · {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"} ·{" "}
                      {t.lots.toFixed(2)} lots
                    </div>
                  </div>
                  <span className={`num shrink-0 text-[14px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
                    {money(t.netPnl)}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 text-center text-[12px]" style={{ borderTop: "1px solid var(--line)", color: "var(--ink3)" }}>
            {count(pending.length - top.length)} more waiting
          </div>
        </Card>
      )}
    </div>
  );
}
