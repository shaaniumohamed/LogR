import Link from "next/link";
import { computeStats, costPicture } from "@/lib/core/metrics";
import { byHourLocal, byLocalDay } from "@/lib/core/analysis";
import { loadTrades, recentSlice, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { BarChart, CurveChart, VersusBar } from "@/components/charts";
import { Card, Empty, Estimated, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One plain sentence saying how it is going. Written before any number is shown. */
function verdict(edge: number | null, net: number, n: number) {
  if (edge === null) return `You have ${count(n)} logged. Not enough losses yet to judge an edge.`;
  if (edge < 0) return `You are losing money. Your wins are not frequent enough to cover the size of your losses.`;
  if (edge < 1) return `You are running at roughly break-even. There is an edge, but it is too small to rely on.`;
  if (edge < 5) return `You have a real but modest edge. It works, and it would not survive much slippage.`;
  return `You have a clear edge. Your win rate comfortably exceeds what your win and loss sizes require.`;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const period = resolvePeriod((await searchParams).period);
  const { all, trades, timeZone, isEmpty } = await loadTrades(period);

  if (isEmpty) {
    return (
      <Empty
        title="Nothing imported yet"
        body="Drop in a broker CSV and this fills itself in. You get the numbers before you fill out a single form."
        action={
          <Link href="/import" className="inline-block rounded-lg px-4 py-2.5 text-sm font-semibold"
                style={{ background: "var(--ink)", color: "var(--plane)" }}>
            Import trade history
          </Link>
        }
      />
    );
  }

  const s = computeStats(trades);
  const cost = costPicture(s.net, s.totalLots);
  const days = byLocalDay(trades, timeZone);
  const hours = byHourLocal(trades, timeZone);

  // Only hours that lost on most of the days they were traded. An hour can show a
  // big negative total from one catastrophic day and be fine otherwise; calling
  // that a pattern would send the trader after the wrong thing (docs/20 §3.3).
  const badHours = hours.filter((h) => h.consistent).sort((a, b) => a.net - b.net).slice(0, 3);

  let running = 0;
  const curve = days.map((d) => (running += d.net));
  const profitableDays = days.filter((d) => d.net > 0).length;

  // Recent form against lifetime. These diverged sharply on real data, and showing
  // only the lifetime figure would misrepresent how the trader is doing now.
  const recent = recentSlice(all, 30);
  const rs = computeStats(recent);
  const lifetime = computeStats(all);
  const formGap = (rs.edgePoints ?? 0) - (lifetime.edgePoints ?? 0);
  const showForm = period === "all" && recent.length >= 30 && recent.length < all.length && Math.abs(formGap) > 1.5;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PeriodTabs base="/dashboard" active={period} />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          {count(trades.length)} · {days.length} trading {days.length === 1 ? "day" : "days"}
        </span>
      </div>

      <Card>
        <Eyebrow>How it is going</Eyebrow>
        <Verdict>{verdict(s.edgePoints, s.net, s.n)}</Verdict>
        <div className="mt-4 flex items-end gap-3">
          <div className={`num text-4xl font-semibold tracking-tight ${s.net >= 0 ? "pos" : "neg"}`}>
            {money(s.net)}
          </div>
          <div className="pb-1.5 text-[13px]" style={{ color: "var(--ink2)" }}>
            kept from {count(s.n)}
          </div>
        </div>

        <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="text-[13px] font-semibold">Is your win rate good enough?</div>
          <Note>
            A win rate only means something next to your win and loss sizes. Your average
            win is {money(s.avgWin)} and your average loss is {money(s.avgLoss)}, so you
            need to win <b>{s.breakEvenWinRate ? pct(s.breakEvenWinRate) : "—"}</b> of the
            time simply to stand still.
          </Note>
          {s.breakEvenWinRate !== null && (
            <VersusBar
              actual={s.winRate} target={s.breakEvenWinRate}
              actualLabel="You win this often" targetLabel="You need this to break even"
              format={(v) => pct(v)}
            />
          )}
          {s.edgePoints !== null && (
            <p className="mt-3 text-[13px]">
              <b className={s.edgePoints > 0 ? "pos" : "neg"}>
                {s.edgePoints > 0 ? "+" : "−"}{Math.abs(s.edgePoints).toFixed(2)} points
              </b>{" "}
              <span style={{ color: "var(--ink2)" }}>
                of margin{s.edgePoints > 0 && s.edgePoints < 2 ? " — thin enough that a bad week erases it" : ""}.
              </span>
            </p>
          )}
        </div>
      </Card>

      <StatGrid>
        <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins} won, ${s.losses} lost`} />
        <Stat label="Made per $1 lost" value={s.profitFactor?.toFixed(2) ?? "—"}
              sub={`${money0(s.grossProfit)} in, ${money0(-s.grossLoss)} out`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"}
              sub={`${s.avgHoldMinutes.toFixed(0)} min typical hold`} />
        <Stat label="Winning days" value={`${profitableDays} of ${days.length}`}
              sub={days.length ? pct(profitableDays / days.length, 0) : undefined} />
      </StatGrid>

      {showForm && (
        <Card>
          <Eyebrow>Recent form</Eyebrow>
          <Verdict>
            Your last 30 days look {formGap > 0 ? "much better" : "worse"} than your lifetime
            average, so the all-time number {formGap > 0 ? "understates" : "overstates"} where
            you are now.
          </Verdict>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {[["Last 30 days", rs], ["All time", lifetime]].map(([label, st]) => {
              const x = st as typeof rs;
              return (
                <div key={label as string} className="rounded-lg p-3" style={{ background: "var(--s3)" }}>
                  <div className="text-[11px] font-semibold" style={{ color: "var(--ink2)" }}>{label as string}</div>
                  <div className={`num mt-1 text-lg font-semibold ${(x.edgePoints ?? 0) > 0 ? "pos" : "neg"}`}>
                    {x.edgePoints !== null ? `${x.edgePoints > 0 ? "+" : "−"}${Math.abs(x.edgePoints).toFixed(1)} pts` : "—"}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--ink3)" }}>
                    {money0(x.net)} · {count(x.n)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <Eyebrow>Money over time</Eyebrow>
        <Verdict>
          Running total across {days.length} trading {days.length === 1 ? "day" : "days"}.
          The shaded area shows how far you fell below your best point.
        </Verdict>
        <CurveChart points={curve} format={(v) => money0(v)} aria="Running profit with drawdown shaded" />
      </Card>

      <Card>
        <Eyebrow>What the spread costs you<Estimated /></Eyebrow>
        <Verdict>
          Your trading earned roughly <b>{money0(cost.grossLo)}–{money0(cost.grossHi)}</b> before
          costs. The spread took <b className="neg">{money0(cost.costLo)}–{money0(cost.costHi)}</b> of
          it. You kept <b>{money(s.net)}</b>.
        </Verdict>
        <BarChart
          rows={[
            { label: "What you earned", value: (cost.grossLo + cost.grossHi) / 2, meta: "before costs" },
            { label: "Spread took", value: -(cost.costLo + cost.costHi) / 2, meta: `over ${s.totalLots.toFixed(1)} lots` },
            { label: "You kept", value: s.net, meta: "after costs", flag: true },
          ]}
          format={(v) => money0(v)} labelWidth={112} aria="Earnings before costs, spread cost, and what was kept"
        />
        <Note>
          <b>Why this is not on your statement:</b> the spread is baked into the price you were
          filled at, so it never appears as a charge. It is the gap every trade has to cover
          before it earns you anything — which is why a strategy can be right more often than
          it is wrong and still leave you close to flat.
          <br /><br />
          <b>Worth checking:</b> a raw-spread account charges visible commission but quotes far
          tighter. At {s.totalLots.toFixed(1)} lots that trade-off is arithmetic, not opinion.
        </Note>
      </Card>

      {badHours.length > 0 && (
        <Card>
          <Eyebrow>Hours that keep costing you</Eyebrow>
          <Verdict>
            These are the times of day, in your own local time, where you lost money on most
            of the days you traded them — not just once badly.
          </Verdict>
          <BarChart
            rows={badHours.map((h) => ({
              label: `${h.label}`,
              value: h.net,
              meta: `${count(h.trades)} · lost on ${h.losingDays} of ${h.days} days`,
            }))}
            format={(v) => money0(v)} labelWidth={74} aria="Hours of day with repeated losses"
          />
          <Note>
            Dropping just your worst hour would have changed this period by{" "}
            <b>{money0(-badHours[0].net)}</b>. That is the cheapest change available to you:
            it needs no new skill, only not trading then.
          </Note>
        </Card>
      )}

      <div className="pt-1 text-center">
        <Link href="/analytics" className="text-[13px] font-semibold" style={{ color: "var(--c1)" }}>
          See every pattern in your trading →
        </Link>
      </div>
    </div>
  );
}
