import Link from "next/link";
import { notFound } from "next/navigation";
import { computeStats, hourIn, localDayKey } from "@/lib/core/metrics";
import { byLocalDay, dayShape, heldOverWeekend, sessionOf } from "@/lib/core/analysis";
import { adjacentTradingDay, dayLabel, monthLabel } from "@/lib/core/calendar";
import { loadTrades } from "@/lib/queries";
import { loadAnnotations } from "@/lib/actions";
import { BarChart, DayCurve } from "@/components/charts";
import { Info } from "@/components/info";
import { Card, Empty, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import { zoneName } from "@/lib/timezones";

export const dynamic = "force-dynamic";

/**
 * One day, end to end.
 *
 * The screen the calendar was always missing. A daily total tells you the day was
 * bad; it cannot tell you the day was won by lunchtime and given away after, which
 * at a hundred orders a day is almost always the real story. So this page leads
 * with the SHAPE of the day rather than its total: where the high point was, what
 * survived to the close, and which hour did the damage.
 *
 * It is also the natural place to step through a week. The arrows move between
 * days that actually have trades, never onto a Saturday.
 */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const { all, account, timeZone, isEmpty } = await loadTrades("all");
  if (isEmpty) {
    return <Empty title="Nothing imported yet" body="Import a broker CSV and your days appear here." />;
  }

  const days = byLocalDay(all, timeZone);
  const dayKeys = days.map((d) => d.date);
  const prev = adjacentTradingDay(dayKeys, date, -1);
  const next = adjacentTradingDay(dayKeys, date, 1);
  const month = date.slice(0, 7);

  const trades = all
    .filter((t) => localDayKey(t.closedAt, timeZone) === date)
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  const header = (
    <div className="flex items-center justify-between gap-2">
      <NavArrow to={prev} glyph="‹" label="Previous trading day" />
      <div className="min-w-0 text-center">
        <div className="truncate text-[15px] font-semibold">
          {dayLabel(date, { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <Link href={`/calendar?month=${month}`} className="text-[11px]" style={{ color: "var(--c1)" }}>
          {monthLabel(month)} ›
        </Link>
      </div>
      <NavArrow to={next} glyph="›" label="Next trading day" />
    </div>
  );

  if (!trades.length) {
    return (
      <div className="space-y-4">
        <Card>{header}</Card>
        <Card>
          <Verdict>You did not trade on this day.</Verdict>
          <Note>
            {prev || next
              ? "Use the arrows to step to the days either side — they skip straight to days you actually traded."
              : "Nothing either side of it either."}
          </Note>
        </Card>
      </div>
    );
  }

  const s = computeStats(trades);
  const shape = dayShape(trades);
  const annotations = await loadAnnotations(account.id);
  const annotated = new Set(annotations.filter((a) => a.note || a.setup || a.emotion).map((a) => a.identityHash));
  const taggedToday = trades.filter((t) => annotated.has(t.id)).length;

  const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

  const best = trades.reduce((a, b) => (b.netPnl > a.netPnl ? b : a));
  const worst = trades.reduce((a, b) => (b.netPnl < a.netPnl ? b : a));
  const weekendHolds = trades.filter((t) => heldOverWeekend(t.openedAt, t.closedAt));

  // Hours of this day only, in the trader's clock. Every hour they traded is
  // shown, however few trades it holds — inside one day a single hour is the
  // unit of decision, not a sample to be filtered for significance.
  const hourMap = new Map<number, { net: number; n: number }>();
  for (const t of trades) {
    const h = hourIn(t.openedAt, timeZone);
    const g = hourMap.get(h) ?? { net: 0, n: 0 };
    g.net += t.netPnl; g.n += 1;
    hourMap.set(h, g);
  }
  const hourRows = [...hourMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, g]) => ({
      label: `${String(h).padStart(2, "0")}:00`,
      value: Math.round(g.net * 100) / 100,
      meta: `${count(g.n)} · ${sessionOf(h)}`,
    }));

  const curvePoints = trades.map((t, i) => ({ at: fmtTime.format(t.closedAt), value: shape.curve[i] }));
  const peakTime = shape.peakAt ? fmtTime.format(shape.peakAt) : null;

  return (
    <div className="space-y-4">
      <Card>{header}</Card>

      <Card>
        <Eyebrow>The day</Eyebrow>
        <Verdict>
          {shape.gaveBackMost && peakTime
            ? `You were up ${money0(shape.peak)} at ${peakTime} and finished at ${money0(shape.close)}. Most of this day was made and then handed back.`
            : s.net >= 0
              ? `${money(s.net)} across ${count(s.n)}, winning ${pct(s.winRate, 0)} of the ones that were decided.`
              : `${money(s.net)} across ${count(s.n)}. ${worst.netPnl < s.net * 0.6 ? "One trade did most of the damage." : "The loss was spread across the day rather than sitting in one trade."}`}
        </Verdict>

        <div className="mt-3 flex items-end gap-3">
          <div className={`num text-4xl font-semibold tracking-tight ${s.net >= 0 ? "pos" : "neg"}`}>{money(s.net)}</div>
          <div className="pb-1.5 text-[13px]" style={{ color: "var(--ink2)" }}>
            from {count(s.n)} · {s.totalLots.toFixed(2)} lots
          </div>
        </div>

        <div className="mt-4">
          <StatGrid cols={4}>
            <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins}W · ${s.losses}L`} />
            <Stat label="Best trade" value={money0(best.netPnl)} tone="pos" sub={fmtTime.format(best.closedAt)} />
            <Stat label="Worst trade" value={money0(worst.netPnl)} tone="neg" sub={fmtTime.format(worst.closedAt)} />
            <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"}
                  sub={`${s.avgHoldMinutes.toFixed(0)} min hold`} />
          </StatGrid>
        </div>
      </Card>

      {curvePoints.length >= 2 && (
        <Card>
          <Eyebrow>How the day ran · {zoneName(timeZone)}</Eyebrow>
          <Verdict>
            {shape.peak > 0 && peakTime
              ? `Your best point was ${money0(shape.peak)} at ${peakTime}.`
              : `This day never went green — the best it got was ${money0(shape.peak)}.`}
            {shape.gaveBack > 0.5 && shape.peak > 0
              ? ` You finished ${money0(shape.gaveBack)} below it.`
              : shape.peak > 0 ? " You kept it to the close." : ""}
          </Verdict>
          <DayCurve points={curvePoints} format={(v) => money0(v)}
                    aria="Running profit through the day, in the order trades closed" />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: "var(--ink2)" }}>
            <span>best <b className="num pos">{money0(shape.peak)}</b>{peakTime ? ` at ${peakTime}` : ""}</span>
            <span>worst <b className="num neg">{money0(shape.worst)}</b></span>
            <span>close <b className={`num ${shape.close >= 0 ? "pos" : "neg"}`}>{money0(shape.close)}</b></span>
          </div>

          {shape.gaveBackMost && (
            <div className="mt-3 rounded-lg p-3 text-[12.5px] leading-relaxed"
                 style={{ background: "var(--s3)", borderLeft: "3px solid var(--warn)", color: "var(--ink2)" }}>
              <b>This day was won and then given back.</b> Everything after {peakTime} cost you{" "}
              <b className="neg">{money0(shape.gaveBack)}</b>. Worth reading the trades below that
              point and asking what changed — usually it is size, or a setup you would not have
              taken first thing in the morning.
            </div>
          )}

          <Info title="Why the line is drawn by trade rather than by clock">
            Each step is one trade closing, in the order the money actually moved. A line
            spaced evenly by the clock would put a long flat stretch through the hours you were
            not trading and squash the busy minutes into nothing — which is exactly backwards
            for reading a day.
            <br /><br />
            This counts closed trades only. A position still open is not in the line, because
            an unrealised number is not a result yet.
          </Info>
        </Card>
      )}

      {hourRows.length >= 2 && (
        <Card>
          <Eyebrow>By hour · {zoneName(timeZone)}</Eyebrow>
          <Verdict>Which hours of this day made the money and which took it.</Verdict>
          <BarChart rows={hourRows} format={(v) => money0(v)} />
          <Note>Grouped by the hour you <b>opened</b> each trade.</Note>
        </Card>
      )}

      {weekendHolds.length > 0 && (
        <Card className="!border-[color:var(--warn)]">
          <Eyebrow>Held through a weekend</Eyebrow>
          <Verdict>
            {count(weekendHolds.length)} closed today {weekendHolds.length === 1 ? "was" : "were"} open
            while the market was shut, coming to{" "}
            {money0(weekendHolds.reduce((x, t) => x + t.netPnl, 0))}.
          </Verdict>
          <Note>Open one to see where the market reopened against the last price you saw.</Note>
        </Card>
      )}

      <Card className="!p-0">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
          <h2 className="eyebrow">Every trade</h2>
          <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
            {taggedToday}/{trades.length} annotated
          </span>
        </div>
        <ul className="mt-3">
          {trades.map((t, i) => {
            const running = shape.curve[i];
            return (
              <li key={t.id} style={{ borderTop: i === 0 ? "1px solid var(--line)" : "1px solid var(--line)" }}>
                <Link href={`/trades/${t.id}`} className="flex items-center gap-3 px-5 py-3">
                  <span className="h-7 w-1 shrink-0 rounded-full"
                        style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-[13.5px] font-semibold">
                      <span className="num" style={{ color: "var(--ink3)" }}>{fmtTime.format(t.openedAt)}</span>
                      <span>{t.direction === "long" ? "Bought" : "Sold"}</span>
                      {annotated.has(t.id) && (
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              style={{ background: "var(--s3)", color: "var(--ink2)" }}>noted</span>
                      )}
                    </div>
                    <div className="num mt-0.5 truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                      {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"} · {t.lots.toFixed(2)} lots ·{" "}
                      {t.holdMinutes < 1 ? "under a minute" : `${Math.round(t.holdMinutes)} min`} · running{" "}
                      {money0(running)}
                    </div>
                  </div>
                  <div className={`num shrink-0 text-right text-[14px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
                    {money(t.netPnl)}
                  </div>
                  <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex items-center justify-between gap-3 pb-1 text-[13px] font-semibold">
        {prev
          ? <Link href={`/day/${prev}`} style={{ color: "var(--c1)" }}>‹ {dayLabel(prev, { weekday: "short", day: "numeric", month: "short" })}</Link>
          : <span />}
        <Link href={`/trades?date=${date}`} style={{ color: "var(--ink2)" }}>Filter all trades →</Link>
        {next
          ? <Link href={`/day/${next}`} style={{ color: "var(--c1)" }}>{dayLabel(next, { weekday: "short", day: "numeric", month: "short" })} ›</Link>
          : <span />}
      </div>
    </div>
  );
}

function NavArrow({ to, glyph, label }: { to: string | null; glyph: string; label: string }) {
  return (
    <Link href={to ? `/day/${to}` : "#"} aria-disabled={!to} aria-label={label} scroll={false}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px]"
          style={{ border: "1px solid var(--line)", color: to ? "var(--ink2)" : "var(--line)",
                   pointerEvents: to ? "auto" : "none" }}>
      {glyph}
    </Link>
  );
}
