import Link from "next/link";
import { computeStats, hourIn, localDayKey } from "@/lib/core/metrics";
import { heldOverWeekend, holdBucket, sessionOf, weekdayIn } from "@/lib/core/analysis";
import { monthLabel } from "@/lib/core/calendar";
import { loadTrades, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { Filters, Segmented, type FilterGroup } from "@/components/filters";
import { Card, Empty, Stat, StatGrid, count, money, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const RESULTS = [
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "big_win", label: "Biggest wins" },
  { value: "big_loss", label: "Biggest losses" },
  { value: "weekend", label: "Held over a weekend" },
] as const;

const SHAPES = [
  { value: "laddered", label: "Laddered in" },
  { value: "single", label: "Single entry" },
  { value: "scaled", label: "Scaled out" },
  { value: "stop", label: "Had a stop" },
  { value: "nostop", label: "No stop" },
] as const;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const SESSIONS = ["Asia", "London", "New York", "Late"] as const;
const HOLDS = ["Under 1 min", "1–3 min", "3–10 min", "10–30 min", "Over 30 min"] as const;
const DIRECTIONS = [{ value: "long", label: "Bought" }, { value: "short", label: "Sold" }] as const;

const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "best", label: "Best" },
  { value: "worst", label: "Worst" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];

/** Plain words for how the trade ended — "so" and "tp" mean nothing to a reader. */
function endedHow(t: ZoneTrade): string | null {
  if (t.closeReasons.includes("so")) return "Margin call";
  if (t.closeReasons.includes("tp")) return "Hit target";
  if (t.closeReasons.includes("sl")) return "Hit stop";
  return null;
}

/**
 * Top or bottom decile by result, never fewer than ten trades.
 *
 * A "biggest wins" filter with a fixed dollar threshold is meaningless across
 * account sizes and across a friend's account entirely — a share of the
 * distribution travels.
 */
function extremes(pool: ZoneTrade[], end: "top" | "bottom"): Set<string> {
  const sorted = [...pool].sort((a, b) => (end === "top" ? b.netPnl - a.netPnl : a.netPnl - b.netPnl));
  const take = Math.max(10, Math.ceil(pool.length * 0.1));
  return new Set(sorted.slice(0, take).map((t) => t.id));
}

export default async function Trades({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const period = resolvePeriod(sp.period);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const PER = 100;

  const { all, trades, timeZone, isEmpty } = await loadTrades(period);
  if (isEmpty) {
    return <Empty title="No trades yet" body="Import a broker CSV and every trade shows up here." />;
  }

  const oneOf = <T extends string>(raw: string | undefined, allowed: readonly T[]): T | null =>
    allowed.includes(raw as T) ? (raw as T) : null;

  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  // A specific date overrides the period window, or a calendar tap into an older
  // month would silently return nothing.
  const pool = onDate ? all.filter((t) => localDayKey(t.closedAt, timeZone) === onDate) : trades;

  const result = oneOf(sp.result, RESULTS.map((r) => r.value));
  const shape = oneOf(sp.shape, SHAPES.map((s) => s.value));
  const day = oneOf(sp.day, WEEKDAYS);
  const sess = oneOf(sp.session, SESSIONS);
  const hold = oneOf(sp.hold, HOLDS);
  const dir = oneOf(sp.direction, DIRECTIONS.map((d) => d.value));
  const hour = /^\d{1,2}$/.test(sp.hour ?? "") && Number(sp.hour) < 24 ? String(Number(sp.hour)) : null;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : null;
  const sort = (oneOf(sp.sort, SORTS.map((s) => s.value)) ?? "recent") as SortKey;

  // Computed over the unfiltered pool, so "biggest wins" keeps meaning the same
  // thing once another filter is added rather than re-deciding from what is left.
  const bigWins = result === "big_win" ? extremes(pool, "top") : null;
  const bigLosses = result === "big_loss" ? extremes(pool, "bottom") : null;

  let filtered = pool;
  if (result === "won") filtered = filtered.filter((t) => t.netPnl > 0);
  if (result === "lost") filtered = filtered.filter((t) => t.netPnl < 0);
  if (bigWins) filtered = filtered.filter((t) => bigWins.has(t.id));
  if (bigLosses) filtered = filtered.filter((t) => bigLosses.has(t.id));
  if (result === "weekend") filtered = filtered.filter((t) => heldOverWeekend(t.openedAt, t.closedAt));
  if (shape === "laddered") filtered = filtered.filter((t) => t.legCount > 1);
  if (shape === "single") filtered = filtered.filter((t) => t.legCount === 1);
  if (shape === "scaled") filtered = filtered.filter((t) => t.exitCount > t.legCount);
  if (shape === "stop") filtered = filtered.filter((t) => t.hadStop);
  if (shape === "nostop") filtered = filtered.filter((t) => !t.hadStop);
  if (day) filtered = filtered.filter((t) => weekdayIn(t.openedAt, timeZone) === day);
  if (sess) filtered = filtered.filter((t) => sessionOf(hourIn(t.openedAt, timeZone)) === sess);
  if (hour) filtered = filtered.filter((t) => hourIn(t.openedAt, timeZone) === Number(hour));
  if (hold) filtered = filtered.filter((t) => holdBucket(t.holdMinutes) === hold);
  if (dir) filtered = filtered.filter((t) => t.direction === dir);
  if (month) filtered = filtered.filter((t) => localDayKey(t.closedAt, timeZone).startsWith(month));

  const sorted = [...filtered].sort((a, b) =>
    sort === "oldest" ? a.closedAt.getTime() - b.closedAt.getTime()
    : sort === "best" ? b.netPnl - a.netPnl
    : sort === "worst" ? a.netPnl - b.netPnl
    : b.closedAt.getTime() - a.closedAt.getTime());

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      period, date: onDate, result, shape, day, session: sess, hour, hold,
      direction: dir, month, sort: sort === "recent" ? null : sort,
      page: page > 1 ? String(page) : null, ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v !== null && v !== undefined) p.set(k, v);
    const qs = p.toString();
    return qs ? `/trades?${qs}` : "/trades";
  };

  // Only hours and months this trader actually traded. A 24-chip row of which
  // fourteen are always empty is a worse control than a short honest one.
  const hoursUsed = [...new Set(pool.map((t) => hourIn(t.openedAt, timeZone)))].sort((a, b) => a - b);
  const monthsUsed = [...new Set(all.map((t) => localDayKey(t.closedAt, timeZone).slice(0, 7)))].sort().reverse();

  const groups: FilterGroup[] = [
    { key: "result", label: "Result", active: result, tone: "ink", options: [...RESULTS] },
    { key: "shape", label: "How it was built", active: shape, options: [...SHAPES] },
    { key: "direction", label: "Direction", active: dir, options: [...DIRECTIONS] },
    { key: "day", label: "Day of week", active: day,
      options: WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3) })) },
    { key: "session", label: "Session", active: sess,
      options: SESSIONS.map((x) => ({ value: x, label: x })) },
    { key: "hour", label: "Hour you opened it", active: hour,
      options: hoursUsed.map((h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` })) },
    { key: "hold", label: "How long you held", active: hold,
      options: HOLDS.map((h) => ({ value: h, label: h })) },
    ...(monthsUsed.length > 1
      ? [{ key: "month", label: "Month", active: month,
           options: monthsUsed.map((m) => ({ value: m, label: monthLabel(m) })) } as FilterGroup]
      : []),
  ];

  const s = computeStats(sorted);
  const pages = Math.max(1, Math.ceil(sorted.length / PER));
  const safePage = Math.min(page, pages);
  const shown = sorted.slice((safePage - 1) * PER, safePage * PER);

  const fmtDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone });
  const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

  return (
    <div className="space-y-4">
      {onDate ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
             style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
          <Link href={`/day/${onDate}`} className="text-[13px] font-semibold">
            {new Date(`${onDate}T12:00:00Z`).toLocaleDateString("en-GB",
              { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} ›
          </Link>
          <Link href="/trades" className="text-[12.5px]" style={{ color: "var(--c1)" }}>Clear</Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodTabs base="/trades" active={period} />
          <span className="text-[11px]" style={{ color: "var(--ink3)" }}>times in your local time</span>
        </div>
      )}

      <Filters groups={groups} href={href} showing={sorted.length} total={pool.length} />

      <div className="flex items-center justify-between gap-3">
        <Segmented options={[...SORTS]} active={sort} href={href} param="sort" />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          {count(sorted.length)}
        </span>
      </div>

      <StatGrid cols={3}>
        <Stat label="Net result" value={money(s.net)} tone={s.net >= 0 ? "pos" : "neg"} sub={count(s.n)} />
        <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins} won, ${s.losses} lost`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"} />
      </StatGrid>

      {shown.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-[15px] font-semibold">Nothing matches all of those</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[13px]" style={{ color: "var(--ink2)" }}>
            Remove one of the filters above and the list will fill back in.
          </p>
        </Card>
      ) : (
        <Card className="!p-0">
          <ul>
            {shown.map((t, i) => {
              const how = endedHow(t);
              const weekend = heldOverWeekend(t.openedAt, t.closedAt);
              const dayKey = localDayKey(t.closedAt, timeZone);
              return (
                <li key={t.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                  <Link href={`/trades/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="h-7 w-1 shrink-0 rounded-full"
                          style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13.5px] font-semibold">
                        <span>{t.direction === "long" ? "Bought" : "Sold"} {t.symbol}</span>
                        {how && <Tag>{how}</Tag>}
                        {weekend && <Tag warn>Over a weekend</Tag>}
                      </div>
                      <div className="num mt-0.5 truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                        {fmtDay.format(t.openedAt)} {fmtTime.format(t.openedAt)} ·{" "}
                        {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"}
                        {t.exitCount > t.legCount ? `, ${t.exitCount} exits` : ""} ·{" "}
                        {t.lots.toFixed(2)} lots ·{" "}
                        {t.holdMinutes < 1 ? "under a minute" : `${Math.round(t.holdMinutes)} min`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`num text-[14px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
                        {money(t.netPnl)}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--ink3)" }}>{dayKey.slice(5)}</div>
                    </div>
                    <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          {safePage > 1
            ? <Link href={href({ page: String(safePage - 1) })} style={{ color: "var(--c1)" }}>← Newer</Link>
            : <span />}
          <span style={{ color: "var(--ink3)" }}>Page {safePage} of {pages}</span>
          {safePage < pages
            ? <Link href={href({ page: String(safePage + 1) })} style={{ color: "var(--c1)" }}>Older →</Link>
            : <span />}
        </div>
      )}
    </div>
  );
}

function Tag({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
          style={warn
            ? { background: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn)" }
            : { background: "var(--s3)", color: "var(--ink2)" }}>
      {children}
    </span>
  );
}
