import { comebacks } from "@/lib/core/excursion";
import type { TradeExcursion } from "@/lib/excursion-data";
import { Info } from "@/components/info";
import { money, money0 } from "@/components/ui";

/**
 * Where a trade stops coming back.
 *
 * Built for a trader with no fixed stop, whose invalidation is a judgement
 * made live. The single most useful thing their history can tell them is how
 * far against the first entry a trade can go and still be worth holding — and
 * the point past which it almost never comes back. That point is a stop the
 * data drew, not one picked from a rule of thumb.
 */
export function HeatCard({ items }: { items: TradeExcursion[] }) {
  const rows = comebacks(items, 5);
  if (!rows.length) return null;

  // The first band where fewer than one trade in three still comes back. Past
  // that, holding is mostly paying for hope; any looser and the "cliff" would
  // land on ordinary variation between bands of a few dozen trades each.
  const cliff = rows.find((r, i) => i > 0 && r.green / r.n < 1 / 3);

  const winners = items.filter((x) => x.final > 0 && x.best > 0);
  const keptMedian = median(winners.map((x) => x.final / x.best));
  const greenThenRed = items.filter((x) => x.final < 0 && x.best >= 5);
  const givenBack = greenThenRed.reduce((s, x) => s + x.final, 0);
  const avgHeatWinners = mean(winners.map((x) => x.heat));
  const losers = items.filter((x) => x.final < 0);
  const avgHeatLosers = mean(losers.map((x) => x.heat));

  return (
    <section className="card p-5">
      <h2 className="eyebrow">Where trades stop coming back</h2>
      <p className="mt-2 text-[15px] leading-relaxed">
        {cliff
          ? <>Once price went more than <b className="price">{cliff.from.toFixed(2)}</b> against your first
              entry, only <b>{Math.round((cliff.green / cliff.n) * 100)}%</b> of trades finished green.</>
          : <>How often a trade still finished green, by how far price went against your first entry.</>}
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((r) => {
          const share = r.green / r.n;
          const isCliff = r === cliff;
          return (
            <div key={r.from} className="flex items-center gap-3">
              <span className="price w-[96px] shrink-0 text-[12px]" style={{ color: isCliff ? "var(--ink)" : "var(--ink2)", fontWeight: isCliff ? 700 : 500 }}>
                {r.from.toFixed(2)}–{r.to.toFixed(2)}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded-md" style={{ background: "var(--s3)" }}>
                <div className="h-full rounded-md" style={{
                  width: `${Math.max(2, share * 100)}%`,
                  background: share >= 0.5 ? "var(--profit)" : share >= 1 / 3 ? "var(--warn)" : "var(--loss)",
                  opacity: 0.85,
                }} />
              </div>
              <span className="num w-[44px] shrink-0 text-right text-[13px] font-semibold">{Math.round(share * 100)}%</span>
              <span className={`num hidden w-[64px] shrink-0 text-right text-[12px] sm:block ${r.net >= 0 ? "pos" : "neg"}`}>{money0(r.net)}</span>
            </div>
          );
        })}
        <div className="flex justify-between text-[11.5px]" style={{ color: "var(--ink3)" }}>
          <span>How far against your first entry</span>
          <span>finished green</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {keptMedian !== null && (
          <Fact label="Winners kept" value={`${Math.round(keptMedian * 100)}%`} sub="of the best they got, typically" />
        )}
        <Fact label="Green, then red" value={String(greenThenRed.length)}
              sub={greenThenRed.length ? `up $5+ first, then closed for ${money0(givenBack)}` : "none were up $5 first"} />
        {avgHeatWinners !== null && avgHeatLosers !== null && (
          <Fact label="Typical heat" value={money(avgHeatWinners)} sub={`on winners, against ${money(avgHeatLosers)} on losers`} />
        )}
      </div>

      <Info title="How to use this">
        Your stop is a judgement made live, which is a strength right up until the trade that
        should have been cut is the one you hold. This is the evidence for where that judgement
        should land: past the band where trades stop coming back, holding on is mostly paying
        for hope.
        <br /><br />
        Measured on your last {items.length} trades that have one-minute charts, against the
        price of your FIRST entry — the level you read, before any ladder. Each band holds the
        same number of trades, so the edges sit where your trades actually fall. Heat figures are
        floors: see any trade&rsquo;s own page for how they are measured.
      </Info>
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile rounded-xl px-3.5 py-3">
      <div className="text-[12px] font-medium" style={{ color: "var(--ink2)" }}>{label}</div>
      <div className="num mt-0.5 text-[19px] font-semibold tracking-tight">{value}</div>
      <div className="text-[11.5px] leading-snug" style={{ color: "var(--ink3)" }}>{sub}</div>
    </div>
  );
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
