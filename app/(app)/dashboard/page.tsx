import Link from "next/link";
import { computeStats, costPicture } from "@/lib/core/metrics";
import { byHourLocal, byLocalDay, monthKey, weekKey } from "@/lib/core/analysis";
import { localDayKey } from "@/lib/core/metrics";
import { loadTrades, recentSlice, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { MonthCalendar, PeriodTrend } from "@/components/month-calendar";
import { monthLabel } from "@/lib/core/calendar";
import { BarChart, CurveChart, VersusBar } from "@/components/charts";
import { Info } from "@/components/info";
import { Card, Empty, Estimated, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import { zoneName } from "@/lib/timezones";
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
  const { all, trades, timeZone, isEmpty } = await loadTrades(period);

  if (isEmpty) {
    return (
      <Empty
        title="Nothing imported yet"
        body="Drop in a broker CSV and this fills itself in."
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
  const allDays = byLocalDay(all, timeZone);
  const hours = byHourLocal(trades, timeZone);
  const badHours = hours.filter((h) => h.consistent).sort((a, b) => a.net - b.net).slice(0, 3);

  // The same bounds the Calendar tab uses, so stepping months behaves identically
  // wherever the grid is shown: every month from the first trade to now, including
  // the ones with nothing in them.
  const today = localDayKey(new Date(), timeZone);
  const firstMonth = allDays[0].date.slice(0, 7);
  const lastTradedMonth = allDays[allDays.length - 1].date.slice(0, 7);
  const lastMonth = lastTradedMonth > today.slice(0, 7) ? lastTradedMonth : today.slice(0, 7);
  const asked = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : lastMonth;
  const month = asked < firstMonth ? firstMonth : asked > lastMonth ? lastMonth : asked;
  const scale = Math.max(...allDays.map((d) => Math.abs(d.net)), 1);

  let running = 0;
  const curve = days.map((d) => (running += d.net));
  const upDays = days.filter((d) => d.net > 0).length;

  const weeks = trendRows(all, (t) => weekKey(t.closedAt, timeZone),
    (k) => `w/c ${new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`, 8);
  const monthsTrend = trendRows(all, (t) => monthKey(t.closedAt, timeZone), monthLabel, 8);

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
          {count(trades.length)} · {days.length} days
        </span>
      </div>

      <Card>
        <Eyebrow>How it's going</Eyebrow>
        <Verdict>{verdict(s.edgePoints, s.n)}</Verdict>
        <div className="mt-3 flex items-end gap-3">
          <div className={`num text-4xl font-semibold tracking-tight ${s.net >= 0 ? "pos" : "neg"}`}>{money(s.net)}</div>
          <div className="pb-1.5 text-[13px]" style={{ color: "var(--ink2)" }}>from {count(s.n)}</div>
        </div>

        {s.breakEvenWinRate !== null && (
          <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="text-[13px] font-semibold">Win rate against what it needs to be</div>
            <VersusBar actual={s.winRate} target={s.breakEvenWinRate}
                       actualLabel="You win" targetLabel="Break-even needs" format={(v) => pct(v)} />
            <p className="mt-3 text-[13px]">
              <b className={(s.edgePoints ?? 0) > 0 ? "pos" : "neg"}>
                {(s.edgePoints ?? 0) > 0 ? "+" : "−"}{Math.abs(s.edgePoints ?? 0).toFixed(2)} points
              </b>{" "}
              <span style={{ color: "var(--ink2)" }}>of margin.</span>
            </p>
            <Info title="Why break-even isn't 50%">
              Your average win is {money(s.avgWin)} and your average loss is {money(s.avgLoss)}. When
              losses are bigger than wins you have to win more often just to stay level — the exact
              rate is {pct(s.breakEvenWinRate)}. The gap between that and your actual win rate is the
              whole edge.
            </Info>
          </div>
        )}
      </Card>

      <StatGrid>
        <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins}W · ${s.losses}L`} />
        <Stat label="Per $1 lost" value={s.profitFactor?.toFixed(2) ?? "—"}
              sub={`${money0(s.grossProfit)} / ${money0(-s.grossLoss)}`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"}
              sub={`${s.avgHoldMinutes.toFixed(0)} min hold`} />
        <Stat label="Days up" value={`${upDays}/${days.length}`}
              sub={days.length ? pct(upDays / days.length, 0) : undefined} />
      </StatGrid>

      {showForm && (
        <Card>
          <Eyebrow>Recent form</Eyebrow>
          <Verdict>
            Your last 30 days look {formGap > 0 ? "better" : "worse"} than your all-time average.
          </Verdict>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {([["Last 30 days", rs], ["All time", lifetime]] as const).map(([label, x]) => (
              <div key={label} className="rounded-lg p-3" style={{ background: "var(--s3)" }}>
                <div className="text-[11px] font-semibold" style={{ color: "var(--ink2)" }}>{label}</div>
                <div className={`num mt-1 text-lg font-semibold ${(x.edgePoints ?? 0) > 0 ? "pos" : "neg"}`}>
                  {x.edgePoints !== null ? `${x.edgePoints > 0 ? "+" : "−"}${Math.abs(x.edgePoints).toFixed(1)} pts` : "—"}
                </div>
                <div className="num text-[11px]" style={{ color: "var(--ink3)" }}>{money0(x.net)} · {count(x.n)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>Calendar</Eyebrow>
          <Link href={`/calendar?month=${month}`} className="text-[12px] font-semibold" style={{ color: "var(--c1)" }}>
            Open calendar →
          </Link>
        </div>
        <div className="mt-2">
          <MonthCalendar days={allDays} month={month} first={firstMonth} last={lastMonth}
                         base="/dashboard" scale={scale} today={today} />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Eyebrow>Week by week</Eyebrow>
          <PeriodTrend rows={weeks} label="week" />
        </Card>
        <Card>
          <Eyebrow>Month by month</Eyebrow>
          <PeriodTrend rows={monthsTrend} label="month" />
        </Card>
      </div>

      <Card>
        <Eyebrow>Running total</Eyebrow>
        <CurveChart points={curve} format={(v) => money0(v)} aria="Running profit with drawdown shaded" />
      </Card>

      <Card>
        <Eyebrow>Spread cost<Estimated /></Eyebrow>
        <Verdict>
          You kept <b>{money(s.net)}</b> of an estimated{" "}
          <b>{money0(cost.grossLo)}–{money0(cost.grossHi)}</b> earned before costs.
        </Verdict>
        <BarChart
          rows={[
            { label: "Earned", value: (cost.grossLo + cost.grossHi) / 2, meta: "before costs" },
            { label: "Spread", value: -(cost.costLo + cost.costHi) / 2, meta: `${s.totalLots.toFixed(1)} lots traded` },
            { label: "Kept", value: s.net, meta: "after costs", flag: true },
          ]}
          format={(v) => money0(v)}
        />
        <Info title="Why this isn't on your statement">
          The spread is built into the price you were filled at, so it never appears as a charge.
          It's the gap every trade covers before it earns anything — which is how a strategy can
          be right more often than it's wrong and still finish close to flat.
          <br /><br />
          A raw-spread account charges visible commission but quotes tighter. At{" "}
          {s.totalLots.toFixed(1)} lots that trade-off is arithmetic, worth checking.
        </Info>
      </Card>

      {badHours.length > 0 && (
        <Card>
          <Eyebrow>Costly hours · {zoneName(timeZone)}</Eyebrow>
          <Verdict>Hours you lost on most days you traded them.</Verdict>
          <BarChart
            rows={badHours.map((h) => ({
              label: h.label, value: h.net,
              meta: `${count(h.trades)} · down ${h.losingDays} of ${h.days} days`,
            }))}
            format={(v) => money0(v)}
          />
          <Note>Skipping your worst hour alone would be worth {money0(-badHours[0].net)}.</Note>
        </Card>
      )}

      <div className="pt-1 text-center">
        <Link href="/analytics" className="text-[13px] font-semibold" style={{ color: "var(--c1)" }}>
          See all patterns →
        </Link>
      </div>
    </div>
  );
}
