import Link from "next/link";
import { notFound } from "next/navigation";
import { computeStats, localDayKey } from "@/lib/core/metrics";
import { byLocalDay, dayShape, heldOverWeekend } from "@/lib/core/analysis";
import { tiltProfile } from "@/lib/core/tilt";
import { daysOfWeek, dayLabel, mondayOf, stepWeek, weekLabel } from "@/lib/core/calendar";
import { loadTrades } from "@/lib/queries";
import { loadAnnotations, loadWeeklyNote } from "@/lib/actions";
import { requireContext } from "@/lib/session";
import { BarChart, DayCurve } from "@/components/charts";
import { Info } from "@/components/info";
import { Card, Empty, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import { WeekNote } from "./week-note";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

/**
 * The week, as a thing you sit down with once.
 *
 * The daily loop already exists and the yearly one never gets done. A week is
 * the unit a trader actually reviews on: long enough that one bad session does
 * not decide it, short enough that the trades are still remembered. It is also
 * the only span over which "I will do X differently" can be set and then
 * checked, which is why the page ends with three boxes and begins by showing
 * what was written in them last week.
 */
export default async function WeekPage({ params }: { params: Promise<{ monday: string }> }) {
  const { monday: raw } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) notFound();
  // Any day in the week resolves to its Monday, so a hand-typed or stale link
  // lands somewhere sensible instead of on a week starting on a Thursday.
  const monday = mondayOf(raw);

  const { account } = await requireContext();
  const [{ all, timeZone, isEmpty }, annotations, note, lastNote] = await Promise.all([
    loadTrades("all"),
    loadAnnotations(account.id),
    loadWeeklyNote(account.id, monday),
    loadWeeklyNote(account.id, stepWeek(monday, -1)),
  ]);

  if (isEmpty) {
    return <Empty title="Nothing to review yet" body="Import your trade history and your weeks appear here." />;
  }

  const days = daysOfWeek(monday);
  const inWeek = all
    .filter((t) => days.includes(localDayKey(t.closedAt, timeZone)))
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  const allDays = byLocalDay(all, timeZone);
  const firstWeek = allDays.length ? mondayOf(allDays[0].date) : monday;
  const lastWeek = mondayOf(localDayKey(new Date(), timeZone));
  const prev = monday > firstWeek ? stepWeek(monday, -1) : null;
  const next = monday < lastWeek ? stepWeek(monday, 1) : null;

  const header = (
    <div className="flex items-center justify-between gap-2">
      <Arrow to={prev} glyph="‹" label="Previous week" />
      <div className="min-w-0 text-center">
        <div className="truncate text-[15px] font-semibold">{weekLabel(monday)}</div>
        <div className="text-[11px]" style={{ color: "var(--ink3)" }}>
          {inWeek.length ? `${count(inWeek.length)} closed` : "no trades"}
        </div>
      </div>
      <Arrow to={next} glyph="›" label="Next week" />
    </div>
  );

  const s = computeStats(inWeek);
  const byDay = new Map(byLocalDay(inWeek, timeZone).map((d) => [d.date, d]));
  const shape = dayShape(inWeek);
  const written = new Set(annotations
    .filter((a) => a.note || a.setup || a.emotion || a.confluences?.length || a.mistakes?.length)
    .map((a) => a.identityHash));

  const dayRows = days
    .map((d) => ({ d, row: byDay.get(d) }))
    .filter((x) => x.row)
    .map(({ d, row }) => ({
      label: dayLabel(d, { weekday: "short", day: "numeric" }),
      value: row!.net,
      meta: `${count(row!.trades)} · won ${pct(row!.stats.winRate, 0)}`,
      href: `/day/${d}`,
    }));

  const bestDay = dayRows.length ? Math.max(...dayRows.map((d) => d.value)) : 0;
  const worstDay = dayRows.length ? Math.min(...dayRows.map((d) => d.value)) : 0;

  const tilt = tiltProfile(inWeek, timeZone, 5);
  const fmtTime = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  /*
   * Three trades, chosen so the reader has something to actually open.
   *
   * A week produces too many to re-read and a page of links produces none. The
   * biggest loss is where the lesson usually is, the biggest win is worth
   * knowing you can repeat, and the largest result still not written up is the
   * one most likely to be forgotten — which makes it the most valuable minute
   * on this page.
   */
  const worst = inWeek.length ? inWeek.reduce((a, b) => (b.netPnl < a.netPnl ? b : a)) : null;
  const best = inWeek.length ? inWeek.reduce((a, b) => (b.netPnl > a.netPnl ? b : a)) : null;
  const unwritten = inWeek
    .filter((t) => !written.has(t.id) && t.id !== worst?.id && t.id !== best?.id)
    .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl))[0] ?? null;

  const picks: { trade: ZoneTrade; why: string }[] = [
    ...(worst && worst.netPnl < 0 ? [{ trade: worst, why: "your worst of the week" }] : []),
    ...(best && best.netPnl > 0 ? [{ trade: best, why: "your best of the week" }] : []),
    ...(unwritten ? [{ trade: unwritten, why: "the biggest one you have not written up" }] : []),
  ];

  const weekendHolds = inWeek.filter((t) => heldOverWeekend(t.openedAt, t.closedAt));

  return (
    <div className="space-y-4">
      <Card>{header}</Card>

      {inWeek.length === 0 ? (
        <Card>
          <Verdict>You did not trade this week.</Verdict>
          <Note>The arrows step to the weeks either side.</Note>
        </Card>
      ) : (
        <>
          <Card>
            <Eyebrow>The week</Eyebrow>
            <Verdict>
              {s.net >= 0
                ? `${money(s.net)} across ${count(s.n)}, on ${dayRows.filter((d) => d.value > 0).length} up days out of ${dayRows.length}.`
                : `${money(s.net)} across ${count(s.n)}. ${
                    dayRows.filter((d) => d.value < 0).length === 1
                      ? "One day did all of it."
                      : `${dayRows.filter((d) => d.value < 0).length} of ${dayRows.length} days finished down.`
                  }`}
            </Verdict>
            <div className="mt-3 flex items-end gap-3">
              <div className={`num text-4xl font-semibold tracking-tight ${s.net >= 0 ? "pos" : "neg"}`}>
                {money(s.net)}
              </div>
              <div className="pb-1.5 text-[13px]" style={{ color: "var(--ink2)" }}>
                from {count(s.n)}
              </div>
            </div>
            <div className="mt-4">
              <StatGrid cols={4}>
                <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins}W · ${s.losses}L`} />
                <Stat label="Average trade" value={money(s.expectancy)}
                      tone={s.expectancy >= 0 ? "pos" : "neg"} />
                <Stat label="Best day" value={money0(bestDay)} tone={bestDay >= 0 ? "pos" : "neg"} />
                <Stat label="Worst day" value={money0(worstDay)} tone={worstDay >= 0 ? "pos" : "neg"} />
              </StatGrid>
            </div>
          </Card>

          <Card>
            <Eyebrow>Day by day</Eyebrow>
            <Verdict>Tap a day to open it.</Verdict>
            <BarChart rows={dayRows} format={(v) => money0(v)} />
          </Card>

          {inWeek.length >= 3 && (
            <Card>
              <Eyebrow>How the week ran</Eyebrow>
              <Verdict>
                {shape.peak > 0 && shape.gaveBack > 0.5
                  ? `The week was ${money0(shape.peak)} up at its best and finished ${money0(shape.gaveBack)} below that.`
                  : "Every trade of the week, in the order they closed."}
              </Verdict>
              <DayCurve
                points={inWeek.map((t, i) => ({ at: fmtTime.format(t.closedAt), value: shape.curve[i] }))}
                format={(v) => money0(v)}
                aria="Running profit through the week, in the order trades closed"
              />
            </Card>
          )}

          {tilt && (
            <Card>
              <Eyebrow>After a loss, this week</Eyebrow>
              <Verdict>
                {tilt.afterLoss.gapMinutes < tilt.afterWin.gapMinutes * 0.7
                  ? `You were back in ${Math.round(tilt.afterWin.gapMinutes - tilt.afterLoss.gapMinutes)} minutes sooner after a loss than after a win.`
                  : "Your re-entry after a loss looked much like after a win."}
              </Verdict>
              {/* Four, not three: the grid is two columns on a phone, and an odd
                  count leaves a hole where a tile should be. */}
              <div className="mt-3">
                <StatGrid cols={4}>
                  <Stat label="Wait after a win" value={`${Math.round(tilt.afterWin.gapMinutes)} min`} />
                  <Stat label="Wait after a loss" value={`${Math.round(tilt.afterLoss.gapMinutes)} min`} />
                  <Stat label="Size after a win" value={`${tilt.afterWin.lots.toFixed(2)}`} sub="lots" />
                  <Stat label="Size after a loss" value={`${tilt.afterLoss.lots.toFixed(2)}`} sub="lots" />
                </StatGrid>
              </div>
              <Note>
                A week is a small sample for this — <Link href="/analytics" className="tap"
                style={{ color: "var(--c1)", fontWeight: 600 }}>the same measurement over everything</Link>{" "}
                is the one to trust.
              </Note>
            </Card>
          )}

          {weekendHolds.length > 0 && (
            <Card className="!border-[color:var(--warn)]">
              <Eyebrow>Held through the weekend</Eyebrow>
              <Verdict>
                {count(weekendHolds.length)} stayed open while the market was shut, coming to{" "}
                {money0(weekendHolds.reduce((x, t) => x + t.netPnl, 0))}.
              </Verdict>
            </Card>
          )}

          {picks.length > 0 && (
            <Card className="!p-0">
              <div className="px-5 pt-5">
                <h2 className="eyebrow">Worth re-reading</h2>
                <Note>Three from this week. Each takes a minute.</Note>
              </div>
              <ul className="mt-3">
                {picks.map(({ trade, why }) => (
                  <li key={trade.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <Link href={`/trades/${trade.id}?from=week`} className="flex items-center gap-3 px-5 py-3">
                      <span className="h-8 w-1 shrink-0 rounded-full"
                            style={{ background: trade.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold">
                          {trade.direction === "long" ? "Bought" : "Sold"} {trade.symbol}
                          {!written.has(trade.id) && (
                            <span className="ml-2 inline-block whitespace-nowrap rounded px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide"
                                  style={{ background: "var(--s3)", color: "var(--ink2)" }}>not written up</span>
                          )}
                        </div>
                        <div className="num truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                          {fmtTime.format(trade.openedAt)} · {why}
                        </div>
                      </div>
                      <span className={`num shrink-0 text-[14px] font-semibold ${trade.netPnl >= 0 ? "pos" : "neg"}`}>
                        {money(trade.netPnl)}
                      </span>
                      <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Card>
        <Eyebrow>Your review</Eyebrow>
        {lastNote?.focus && (
          <div className="mb-4 rounded-lg p-3 text-[12.5px] leading-relaxed"
               style={{ background: "var(--s3)", borderLeft: "3px solid var(--c1)", color: "var(--ink2)" }}>
            <b>Last week you said you would:</b> {lastNote.focus}
            <br />
            <Link href={`/week/${stepWeek(monday, -1)}`} className="tap" style={{ color: "var(--c1)" }}>
              open that week →
            </Link>
          </div>
        )}
        <WeekNote weekStart={monday} existing={note ?? null} />
        <Info title="Why three boxes and not one">
          An empty box gets an empty answer. Naming the three questions is most of what makes a
          weekly review happen at all, and it makes the answers comparable from one week to the
          next in a way a paragraph never is.
          <br /><br />
          The last line is the one that matters. A review that ends without something to change
          is a diary entry, which is why next week&rsquo;s page opens by reminding you what you
          said here.
        </Info>
      </Card>
    </div>
  );
}

function Arrow({ to, glyph, label }: { to: string | null; glyph: string; label: string }) {
  return (
    <Link href={to ? `/week/${to}` : "#"} aria-disabled={!to} aria-label={label} scroll={false}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px]"
          style={{ border: "1px solid var(--line)", color: to ? "var(--ink2)" : "var(--line)",
                   pointerEvents: to ? "auto" : "none" }}>
      {glyph}
    </Link>
  );
}
