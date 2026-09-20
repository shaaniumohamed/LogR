import Link from "next/link";
import { computeStats, localDayKey } from "@/lib/core/metrics";
import { byLocalDay } from "@/lib/core/analysis";
import { loadTrades } from "@/lib/queries";
import { MonthCalendar } from "@/components/month-calendar";
import { monthLabel } from "@/lib/core/calendar";
import { Info } from "@/components/info";
import { Card, Empty, Eyebrow, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import { zoneName } from "@/lib/timezones";

export const dynamic = "force-dynamic";

/**
 * The calendar as a screen of its own.
 *
 * It used to be the fourth card down on the Overview, which on a phone is two
 * and a half screens of scrolling past charts — far enough that it may as well
 * not have existed. A journal's calendar is not a summary widget, it is the way
 * in: you remember Tuesday was bad, you find Tuesday, you open Tuesday. Putting
 * it behind its own tab makes that one tap instead of a hunt.
 */
export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const { all, timeZone, isEmpty } = await loadTrades("all");

  if (isEmpty) {
    return (
      <Empty
        title="No days to show yet"
        body="Import a broker CSV and every day you traded appears here, coloured by what it made."
        action={
          <Link href="/import" className="inline-block rounded-lg px-4 py-2.5 text-sm font-semibold"
                style={{ background: "var(--ink)", color: "var(--plane)" }}>
            Import trade history
          </Link>
        }
      />
    );
  }

  const days = byLocalDay(all, timeZone);
  const today = localDayKey(new Date(), timeZone);

  // The arrows reach every month between your first trade and now — including
  // the ones you took off. A month with nothing in it is a real answer, and
  // arrows that stop at the edge of the data are what make a calendar feel stuck.
  const first = days[0].date.slice(0, 7);
  const lastTraded = days[days.length - 1].date.slice(0, 7);
  const currentMonth = today.slice(0, 7);
  const last = lastTraded > currentMonth ? lastTraded : currentMonth;

  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "");
  const asked = valid ? sp.month! : last;
  const month = asked < first ? first : asked > last ? last : asked;

  const scale = Math.max(...days.map((d) => Math.abs(d.net)), 1);
  const inMonth = days.filter((d) => d.date.startsWith(month));
  const monthTrades = all.filter((t) => localDayKey(t.closedAt, timeZone).startsWith(month));
  const s = computeStats(monthTrades);

  const best = inMonth.length ? inMonth.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const worst = inMonth.length ? inMonth.reduce((a, b) => (b.net < a.net ? b : a)) : null;
  const up = inMonth.filter((d) => d.net > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          days in {zoneName(timeZone)}
        </span>
      </div>

      <Card>
        <MonthCalendar days={days} month={month} first={first} last={last}
                       base="/calendar" scale={scale} today={today} />
      </Card>

      {inMonth.length > 0 ? (
        <>
          <Card>
            <Eyebrow>{monthLabel(month)}</Eyebrow>
            <Verdict>
              {up === inMonth.length
                ? `Every one of your ${inMonth.length} trading days this month finished up.`
                : up === 0
                  ? `None of your ${inMonth.length} trading days this month finished up.`
                  : `${up} of ${inMonth.length} trading days finished up, and the month came to ${money0(s.net)}.`}
            </Verdict>
            <div className="mt-3">
              <StatGrid cols={4}>
                <Stat label="Month" value={money0(s.net)} tone={s.net >= 0 ? "pos" : "neg"} sub={count(s.n)} />
                <Stat label="Days up" value={`${up}/${inMonth.length}`}
                      sub={pct(up / inMonth.length, 0)} />
                <Stat label="Best day" value={best ? money0(best.net) : "—"} tone="pos"
                      sub={best ? best.date.slice(8) + " " + monthLabel(month).split(" ")[0].slice(0, 3) : undefined} />
                <Stat label="Worst day" value={worst ? money0(worst.net) : "—"} tone="neg"
                      sub={worst ? worst.date.slice(8) + " " + monthLabel(month).split(" ")[0].slice(0, 3) : undefined} />
              </StatGrid>
            </div>
            {best && worst && best.date !== worst.date && (
              <p className="mt-3 text-[13px]" style={{ color: "var(--ink2)" }}>
                <Link href={`/day/${worst.date}`} style={{ color: "var(--c1)", fontWeight: 600 }}>
                  Open {worst.date.slice(8)} {monthLabel(month).split(" ")[0]} →
                </Link>{" "}
                your worst day of the month, at {money(worst.net)} across {count(worst.trades)}.
              </p>
            )}
          </Card>

          <Card>
            <Eyebrow>Every day this month</Eyebrow>
            <ul className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
              {[...inMonth].reverse().map((d) => (
                <li key={d.date}>
                  <Link href={`/day/${d.date}`} className="flex items-center gap-3 py-2.5">
                    <span className="h-6 w-1 shrink-0 rounded-full"
                          style={{ background: d.net >= 0 ? "var(--profit)" : "var(--loss)" }} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                      {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB",
                        { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                    </span>
                    <span className="num shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>
                      {count(d.trades)} · won {pct(d.stats.winRate, 0)}
                    </span>
                    <span className={`num w-[74px] shrink-0 text-right text-[13.5px] font-semibold ${d.net >= 0 ? "pos" : "neg"}`}>
                      {money0(d.net)}
                    </span>
                    <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <Card>
          <Eyebrow>{monthLabel(month)}</Eyebrow>
          <Verdict>You did not trade this month.</Verdict>
        </Card>
      )}

      <Card>
        <Eyebrow>How this is put together</Eyebrow>
        <Info title="Which day a trade counts as">
          A trade belongs to the day it <b>closed</b>, in {zoneName(timeZone)} — not the day it
          was opened, and not UTC. That is the only version that adds up: a position opened at
          23:50 and closed at 00:10 made its money after midnight, and counting it against the
          previous day would leave a day&rsquo;s total disagreeing with the trades listed under
          it.
          <br /><br />
          Colour carries how big the day was against your biggest ever, so months stay
          comparable with each other. The amount is printed in every square, so the grid never
          depends on the colour to be read.
        </Info>
      </Card>
    </div>
  );
}
