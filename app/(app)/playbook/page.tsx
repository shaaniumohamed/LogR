import Link from "next/link";
import { computeStats } from "@/lib/core/metrics";
import { tagContrast } from "@/lib/core/analysis";
import { loadTrades, resolvePeriod } from "@/lib/queries";
import { loadAnnotations } from "@/lib/actions";
import { confluenceLabel, feelingLabel, mistakeLabel } from "@/lib/core/taxonomy";
import { PeriodTabs } from "@/components/period-tabs";
import { VersusBar } from "@/components/charts";
import { Info, Caveat } from "@/components/info";
import { Card, Empty, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

/** Below this a setup is a handful of trades wearing a strategy's clothing. */
const MIN_TRADES = 8;

/**
 * Each setup as its own page-within-a-page.
 *
 * Patterns answers "what is happening across everything". This answers the
 * question a trader with more than one method actually has: is THIS method
 * working, and what distinguishes the times it does from the times it does not.
 *
 * The thing that makes it worth building rather than another bar chart is the
 * confluence contrast. A checklist tells you what to look for; it cannot tell
 * you which items on it are doing any work, because the ones you believe in are
 * the ones you look for hardest and so they appear on everything. Comparing a
 * tag's share of the winners against its share of the losers can — and it turns
 * a checklist into something that can be shortened.
 */
export default async function Playbook({ searchParams }: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = resolvePeriod((await searchParams).period);
  const { trades, account, isEmpty } = await loadTrades(period);

  if (isEmpty) {
    return <Empty title="Nothing to build a playbook from yet" body="Import your history, then tag a few trades with the setup you took." />;
  }

  const notes = await loadAnnotations(account.id);
  const byHash = new Map(notes.map((a) => [a.identityHash, a]));

  const groups = new Map<string, ZoneTrade[]>();
  for (const t of trades) {
    const setup = byHash.get(t.id)?.setup;
    if (!setup) continue;
    if (!groups.has(setup)) groups.set(setup, []);
    groups.get(setup)!.push(t);
  }

  const tagged = [...groups.values()].reduce((n, xs) => n + xs.length, 0);
  const ready = [...groups.entries()]
    .filter(([, xs]) => xs.length >= MIN_TRADES)
    .map(([setup, xs]) => ({ setup, trades: xs, stats: computeStats(xs) }))
    .sort((a, b) => b.stats.net - a.stats.net);

  const thin = [...groups.entries()]
    .filter(([, xs]) => xs.length < MIN_TRADES)
    .sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs base="/playbook" active={period} />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          {tagged.toLocaleString("en-US")} of {trades.length.toLocaleString("en-US")} tagged
        </span>
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">Playbook</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Each setup on its own, with what separates the times it works from the times it
          does not.
        </p>
      </div>

      {ready.length === 0 ? (
        <Card>
          <Eyebrow>Not enough tagged yet</Eyebrow>
          <Verdict>
            A setup needs {MIN_TRADES} trades behind it before there is anything honest to say
            about it.
            {tagged > 0 ? ` You have tagged ${count(tagged)} so far.` : " Nothing is tagged yet."}
          </Verdict>
          <Note>
            <Link href="/review" style={{ color: "var(--c1)", fontWeight: 600 }}>
              Tag your biggest trades first →
            </Link>{" "}
            The review queue is ordered by size of result, so twenty tags there are worth two
            hundred picked at random.
          </Note>
        </Card>
      ) : (
        ready.map(({ setup, trades: xs, stats }) => {
          const withNotes = xs.map((t) => ({
            won: t.netPnl > 0,
            tags: byHash.get(t.id)?.confluences ?? [],
          }));
          const contrast = tagContrast(withNotes, Math.max(4, Math.round(xs.length * 0.15)));
          const helps = contrast.filter((c) => c.lift > 0.1).slice(0, 3);
          const hurts = contrast.filter((c) => c.lift < -0.1).slice(0, 2);
          const neutral = contrast.filter((c) => Math.abs(c.lift) <= 0.05 && c.seen >= xs.length * 0.6);

          const losers = xs.filter((t) => t.netPnl < 0);
          const mistakeCounts = new Map<string, number>();
          for (const t of losers) {
            for (const m of byHash.get(t.id)?.mistakes ?? []) {
              mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1);
            }
          }
          const topMistake = [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1])[0];

          const feelingCounts = new Map<string, number>();
          for (const t of xs) {
            const f = byHash.get(t.id)?.emotion;
            if (f) feelingCounts.set(f, (feelingCounts.get(f) ?? 0) + 1);
          }
          const topFeeling = [...feelingCounts.entries()].sort((a, b) => b[1] - a[1])[0];

          const link = `/trades?${new URLSearchParams({ period, setup }).toString()}`;

          return (
            <Card key={setup}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Eyebrow>{setup}</Eyebrow>
                  <Verdict>
                    {stats.edgePoints === null
                      ? `${count(stats.n)}, not enough decided trades to judge an edge yet.`
                      : stats.edgePoints > 0
                        ? `Working. You win ${pct(stats.winRate, 0)} against the ${pct(stats.breakEvenWinRate!, 0)} this setup's win and loss sizes need.`
                        : `Not working as it stands. You win ${pct(stats.winRate, 0)} and it needs ${pct(stats.breakEvenWinRate!, 0)} just to break even.`}
                  </Verdict>
                </div>
                <div className={`num shrink-0 text-xl font-semibold ${stats.net >= 0 ? "pos" : "neg"}`}>
                  {money0(stats.net)}
                </div>
              </div>

              {stats.breakEvenWinRate !== null && (
                <VersusBar actual={stats.winRate} target={stats.breakEvenWinRate}
                           actualLabel="You win" targetLabel="Break-even needs" format={(v) => pct(v)} />
              )}

              <div className="mt-4">
                <StatGrid cols={4}>
                  <Stat label="Trades" value={String(stats.n)} sub={`${stats.wins}W · ${stats.losses}L`} />
                  <Stat label="Average trade" value={money(stats.expectancy)}
                        tone={stats.expectancy >= 0 ? "pos" : "neg"} />
                  <Stat label="Win vs loss" value={stats.payoff ? `${stats.payoff.toFixed(2)}×` : "—"}
                        sub={`${money0(stats.avgWin)} / ${money0(-stats.avgLoss)}`} />
                  <Stat label="Typical hold" value={`${stats.avgHoldMinutes.toFixed(0)} min`} />
                </StatGrid>
              </div>

              {(helps.length > 0 || hurts.length > 0) && (
                <div className="mt-4 space-y-2">
                  <div className="text-[12.5px] font-semibold">What separates the winners</div>
                  {helps.map((c) => (
                    <ContrastRow key={c.key} label={confluenceLabel(c.key)} c={c} />
                  ))}
                  {hurts.map((c) => (
                    <ContrastRow key={c.key} label={confluenceLabel(c.key)} c={c} />
                  ))}
                  {neutral.length > 0 && (
                    <p className="pt-1 text-[12px]" style={{ color: "var(--ink3)" }}>
                      {neutral.map((c) => confluenceLabel(c.key)).join(", ")}{" "}
                      {neutral.length === 1 ? "appears" : "appear"} about as often on the losers as on
                      the winners — on this setup {neutral.length === 1 ? "it is" : "they are"} a habit
                      rather than a filter.
                    </p>
                  )}
                </div>
              )}

              {(topMistake || topFeeling) && (
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]" style={{ color: "var(--ink2)" }}>
                  {topMistake && (
                    <span>
                      Most tagged mistake when it fails:{" "}
                      <b>{mistakeLabel(topMistake[0])}</b> ({topMistake[1]} of {losers.length} losers)
                    </span>
                  )}
                  {topFeeling && (
                    <span>Most often taken feeling <b>{feelingLabel(topFeeling[0])}</b></span>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] font-semibold">
                <Link href={link} style={{ color: "var(--c1)" }}>Read all {stats.n} →</Link>
                <Link href={`${link}&sort=worst`} style={{ color: "var(--ink2)" }}>Worst first</Link>
                <Link href={`${link}&sort=best`} style={{ color: "var(--ink2)" }}>Best first</Link>
              </div>
            </Card>
          );
        })
      )}

      {thin.length > 0 && (
        <Card>
          <Eyebrow>Not enough trades yet</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {thin.map(([setup, xs]) => (
              <li key={setup} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{setup}</span>
                <span className="num text-[12px]" style={{ color: "var(--ink3)" }}>
                  {xs.length} of {MIN_TRADES}
                </span>
                <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
                  <div className="h-full rounded-full"
                       style={{ width: `${(xs.length / MIN_TRADES) * 100}%`, background: "var(--c1)" }} />
                </div>
              </li>
            ))}
          </ul>
          <Note>These appear above once they reach {MIN_TRADES} trades.</Note>
        </Card>
      )}

      {ready.length > 0 && (
        <Card>
          <Eyebrow>How to use this</Eyebrow>
          <Info title="What the winner/loser split is actually measuring">
            For each thing you tagged, this compares how often it was present on the trades
            that made money against how often it was present on the ones that lost. A tag on
            most of your winners and few of your losers is separating them. A tag on almost
            everything is not — whatever it is worth, it is not what decides the outcome of
            this setup, and knowing that gives you back the time you spend looking for it.
          </Info>
          <Caveat>
            <b>This describes what happened; it does not predict.</b> A confluence can look
            decisive because it happened to be present during a good week, and your tagging is
            done after you already know the result, which bends it. Treat a strong split as a
            question: drop the neutral one from your checklist for a month, keep tagging, and
            see whether the number moves.
          </Caveat>
        </Card>
      )}
    </div>
  );
}

function ContrastRow({ label, c }: {
  label: string;
  c: { inWinners: number; inLosers: number; lift: number; winners: number; losers: number };
}) {
  const good = c.lift > 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-[38%] min-w-0 shrink-0 text-[13px] leading-tight">
        <div className="truncate font-medium">{label}</div>
        <div className="text-[10.5px]" style={{ color: "var(--ink3)" }}>
          {c.winners} of the winners, {c.losers} of the losers
        </div>
      </div>
      <div className="flex-1 space-y-1">
        <Track share={c.inWinners} colour="var(--profit)" />
        <Track share={c.inLosers} colour="var(--loss)" />
      </div>
      <div className="num w-[54px] shrink-0 text-right text-[12.5px] font-bold"
           style={{ color: good ? "var(--profit)" : "var(--loss)" }}>
        {good ? "+" : "−"}{Math.abs(Math.round(c.lift * 100))}
      </div>
    </div>
  );
}

function Track({ share, colour }: { share: number; colour: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: colour }} />
    </div>
  );
}
