import Link from "next/link";
import { computeStats, costPicture, pointValuePerLot } from "@/lib/core/metrics";
import { spreadRange } from "@/lib/core/instrument";
import { byHourLocal, byLocalDay, maxDrawdown, monthKey, weekKey } from "@/lib/core/analysis";
import { localDayKey } from "@/lib/core/metrics";
import { PERIODS, loadTrades, recentSlice, resolvePeriod } from "@/lib/queries";
import { requireContext } from "@/lib/session";
import { setupState } from "@/lib/onboarding";
import { GettingStarted } from "@/components/getting-started";
import { PeriodTabs } from "@/components/period-tabs";
import { MonthCalendar, PeriodTrend } from "@/components/month-calendar";
import { monthLabel } from "@/lib/core/calendar";
import { BarChart, HeroCurve, VersusBar } from "@/components/charts";
import { LeaksCard } from "@/components/leaks-card";
import { leaksFor } from "@/lib/leaks-data";
import { Info } from "@/components/info";
import { Card, Estimated, Eyebrow, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

function verdict(edge: number | null, n: number) {
  if (edge === null) return `${count(n)} logged. Not enough losses yet to judge an edge.`;
  if (edge < 0) return "Losing. Your wins aren't frequent enough to cover the size of your losses.";
  if (edge < 1) return "Roughly break-even. There's an edge, but it's too small to lean on.";
  if (edge < 5) return "A real but modest edge.";
  return "A clear edge — your win rate comfortably covers your win and loss sizes.";
}

function trendRows(
  trades: ZoneTrade[],
  keyOf: (t: ZoneTrade) => string,
  labelOf: (k: string) => string,
  take: number
) {
  const m = new Map<string, ZoneTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, take)
    .map(([key, items]) => {
      const s = computeStats(items);
      return { key, label: labelOf(key), net: s.net, trades: s.n, winRate: s.winRate };
    });
}

export default async function Dashboard({ searchParams }: {
  searchParams: Promise<{ period?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const period = resolvePeriod(sp.period);
  // Started together: the setup check is one statement and does not depend on
  // the trades, so it costs no extra waiting even though it is a second read.
  const ctx = await requireContext();
  const [{ all, trades, timeZone, isEmpty }, setup] = await Promise.all([
    loadTrades(period),
    setupState(ctx.account.id),
  ]);

  // Nothing imported: the only thing on this screen is how to begin.
  if (isEmpty) return <GettingStarted setup={setup} firstTradeHref={null} />;

  // The habits costing money, over the same period as everything else here.
  const leaks = await leaksFor(trades, timeZone, ctx.account.id, 3);

  const fmtDay = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  const s = computeStats(trades);
  // Shown above everything until the last step is done, then gone for good.
  const gettingStarted = setup.done
    ? null
    : <GettingStarted setup={setup} firstTradeHref={all[0] ? `/trades/${all[0].id}` : null} />;

  /*
   * The spread estimate needs two things the app does not otherwise know: what a
   * point is worth on this account, and what a typical spread on this instrument
   * costs. The first is measured from the trader's own fills. The second comes
   * from a short table and is simply absent for anything not in it — in which
   * case the whole card disappears rather than printing gold's numbers over
   * somebody else's market.
   */
  const perPoint = pointValuePerLot(all);
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const spread = symbols.length === 1 ? spreadRange(symbols[0]) : null;
  const cost = perPoint && spread
    ? costPicture(s.net, s.totalLots, spread.lo, spread.hi, perPoint)
    : null;
  const days = byLocalDay(trades, timeZone);
  const allDays = byLocalDay(all, timeZone);

  // The same bounds the Calendar tab uses, so stepping months behaves identically
  // wherever the grid is shown: every month from the first trade to now, including
  // the ones with nothing in them.
  const today = localDayKey(new Date(), timeZone);
  const firstMonth = allDays[0].date.slice(0, 7);
  const lastTradedMonth = allDays[allDays.length - 1].date.slice(0, 7);
  const lastMonth = lastTradedMonth > today.slice(0, 7) ? lastTradedMonth : today.slice(0, 7);
  // The latest month with trades, for the same reason as the Calendar tab.
  const asked = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : lastTradedMonth;
  const month = asked < firstMonth ? firstMonth : asked > lastMonth ? lastMonth : asked;
  const scale = Math.max(...allDays.map((d) => Math.abs(d.net)), 1);

  let running = 0;
  const curve = days.map((d) => (running += d.net));
  const upDays = days.filter((d) => d.net > 0).length;

  // The deepest fall from a high point. Standard everywhere else and missing
  // here, and on an account traded without platform stops it is not an
  // abstraction — it is the size of the hole a mental stop has let open once.
  const dd = maxDrawdown(days);

  const weeks = trendRows(all, (t) => weekKey(t.closedAt, timeZone),
    (k) => `w/c ${new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`, 8);
  // Short month names: "September 2026" wrapped onto two lines in a half-width card.
  const shortMonth = (k: string) =>
    new Date(`${k}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const monthsTrend = trendRows(all, (t) => monthKey(t.closedAt, timeZone), shortMonth, 8);

  const recent = recentSlice(all, 30);
  const rs = computeStats(recent);
  const lifetime = computeStats(all);
  const formGap = (rs.edgePoints ?? 0) - (lifetime.edgePoints ?? 0);
  const showForm = period === "all" && recent.length >= 30 && recent.length < all.length && Math.abs(formGap) > 1.5;

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "All time";

  return (
    <div className="space-y-4 lg:space-y-5">
      {gettingStarted}

      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <h1 className="text-[26px] font-semibold leading-none tracking-tight lg:text-[28px]">Home</h1>
        <PeriodTabs base="/dashboard" active={period} />
      </div>

      {/*
        The answer to "how am I doing", first and largest: the result, the
        shape that produced it, and in one sentence what it means. The running
        total used to be its own card eight screens down; it is the most
        natural picture of the headline number, so it sits beside it.
      */}
      <section className="card overflow-hidden">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-8 lg:p-6">
          <div>
            <div className="text-[13px] font-medium" style={{ color: "var(--ink2)" }}>Net result · {periodLabel}</div>
            <div className={`num mt-1.5 text-[40px] font-semibold leading-none tracking-tight lg:text-[46px] ${s.net >= 0 ? "pos" : "neg"}`}>
              {money(s.net)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px]" style={{ color: "var(--ink2)" }}>{count(s.n)} · {days.length} days</span>
              {showForm && (
                <span className="delta" style={formGap > 0
                  ? { background: "color-mix(in srgb, var(--profit) 12%, transparent)", color: "var(--profit)" }
                  : { background: "color-mix(in srgb, var(--loss) 12%, transparent)", color: "var(--loss)" }}>
                  Last 30 days {money0(rs.net)}
                </span>
              )}
            </div>
            <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>{verdict(s.edgePoints, s.n)}</p>
          </div>
          <div className="-mx-1">
            <HeroCurve points={curve} height={150} />
            {dd && (
              <div className="mt-2 flex justify-between px-1 text-[12px]" style={{ color: "var(--ink3)" }}>
                <span>Deepest dip <b className="num neg">{money0(-dd.depth)}</b></span>
                <span>{dd.recoveredAt ? `Recovered ${fmtDay(dd.recoveredAt)}` : `Still under the ${fmtDay(dd.peakAt)} high`}</span>
              </div>
            )}
          </div>
        </div>

        {s.breakEvenWinRate !== null && (
          <div className="border-t px-5 py-4 lg:px-6" style={{ borderColor: "var(--line)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[13.5px] font-semibold">Win rate against what it needs to be</div>
              <span className={`delta ${(s.edgePoints ?? 0) > 0 ? "" : ""}`}
                    style={(s.edgePoints ?? 0) > 0
                      ? { background: "color-mix(in srgb, var(--profit) 12%, transparent)", color: "var(--profit)" }
                      : { background: "color-mix(in srgb, var(--loss) 12%, transparent)", color: "var(--loss)" }}>
                {(s.edgePoints ?? 0) > 0 ? "+" : "−"}{Math.abs(s.edgePoints ?? 0).toFixed(1)} points {(s.edgePoints ?? 0) > 0 ? "ahead" : "short"}
              </span>
            </div>
            <VersusBar actual={s.winRate} target={s.breakEvenWinRate}
                       actualLabel="You win" targetLabel="Break-even needs" format={(v) => pct(v)} />
            <Info title="Why break-even isn't 50%">
              Your average win is {money(s.avgWin)} and your average loss is {money(s.avgLoss)}. When
              losses are bigger than wins you have to win more often just to stay level — the exact
              rate is {pct(s.breakEvenWinRate)}. The gap between that and your actual win rate is the
              whole edge.
            </Info>
          </div>
        )}
      </section>

      <StatGrid>
        <Stat label="Win rate" value={pct(s.winRate)} sub={`${s.wins} won · ${s.losses} lost`} />
        <Stat label="Made per $1 lost" value={s.profitFactor !== null ? `$${s.profitFactor.toFixed(2)}` : "—"}
              sub={`${money0(s.grossProfit)} vs ${money0(-s.grossLoss)}`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"}
              sub={`held ${s.avgHoldMinutes.toFixed(0)} min`} />
        <Stat label="Green days" value={`${upDays} of ${days.length}`}
              sub={days.length ? pct(upDays / days.length, 0) : undefined} />
      </StatGrid>

      {/*
        "Is anything wrong?" — the habits costing money, next to the calendar
        that shows when. Side by side on a desktop, where the old layout stacked
        every card in one narrow column and left two thirds of the screen bare.
      */}
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <LeaksCard leaks={leaks} period={period} compact />
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Calendar</Eyebrow>
            <Link href={`/calendar?month=${month}`} className="tap text-[13px] font-semibold" style={{ color: "var(--c1)" }}>
              Open
            </Link>
          </div>
          <div className="mt-2">
            <MonthCalendar days={allDays} month={month} first={firstMonth} last={lastMonth}
                           base="/dashboard" scale={scale} today={today} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <Card>
          <Eyebrow>Week by week</Eyebrow>
          <PeriodTrend rows={weeks} label="week" />
        </Card>
        <Card>
          <Eyebrow>Month by month</Eyebrow>
          <PeriodTrend rows={monthsTrend} label="month" />
        </Card>
      </div>

      {cost && spread && (
        <Card>
          <Eyebrow>What the spread cost<Estimated /></Eyebrow>
          <Verdict>
            {cost.grossLo > 0
              ? <>Before costs you were up an estimated <b>{money0(cost.grossLo)}–{money0(cost.grossHi)}</b>. The spread took the rest.</>
              : <>The spread added an estimated <b>{money0(cost.costLo)}–{money0(cost.costHi)}</b> to what you lost.</>}
          </Verdict>
          <BarChart
            rows={[
              { label: "Before costs", value: (cost.grossLo + cost.grossHi) / 2, meta: "estimated" },
              { label: "Spread", value: -(cost.costLo + cost.costHi) / 2, meta: `${s.totalLots.toFixed(1)} lots traded` },
              { label: "What you kept", value: s.net, meta: "after costs", flag: true },
            ]}
            format={(v) => money0(v)}
          />
          <Info title="Why this isn't on your statement">
            The spread is built into the price you were filled at, so it never appears as a charge.
            It&rsquo;s the gap every trade covers before it earns anything — which is how a strategy
            can be right more often than it&rsquo;s wrong and still finish close to flat.
            <br /><br />
            A raw-spread account charges visible commission but quotes tighter. At{" "}
            {s.totalLots.toFixed(1)} lots that trade-off is arithmetic, worth checking.
            <br /><br />
            <b>Where the numbers come from.</b> A spread on {symbols[0]} of {spread.describe} is
            assumed — the one thing here that is not measured from your own account. What a point
            is worth to you is worked out from your own fills, so it is right whatever your
            contract size or account currency.
          </Info>
        </Card>
      )}
    </div>
  );
}
