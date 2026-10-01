import Link from "next/link";
import { computeStats, hourIn, localDayKey } from "@/lib/core/metrics";
import { heldOverWeekend, holdBucket, sessionOf, weekdayIn } from "@/lib/core/analysis";
import { monthLabel } from "@/lib/core/calendar";
import { loadTrades, resolvePeriod } from "@/lib/queries";
import { requireContext } from "@/lib/session";
import { loadAnnotations } from "@/lib/actions";
import { newsWindow } from "@/lib/core/news";
import { loadEvents } from "@/lib/news";
import { confluenceLabel, feelingLabel, mistakeLabel } from "@/lib/core/taxonomy";
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

const pad = (h: number) => String(h % 24).padStart(2, "0");

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
  // Fifty, grouped by day, is four or five sessions for a trader at this pace —
  // enough to scan, and half the page weight of the hundred it replaced, which
  // shipped 358KB of HTML and 1,600 elements to a phone to show one screen.
  const PER = 50;

  const { account } = await requireContext();
  const [{ all, trades, timeZone, isEmpty }, notes] = await Promise.all([
    loadTrades(period),
    loadAnnotations(account.id),
  ]);
  if (isEmpty) {
    return <Empty title="No trades yet" body="Import a broker CSV and every trade shows up here." />;
  }

  /*
   * What the trader wrote, joined in so it can be filtered on.
   *
   * This is the half of the journal the broker does not know, and until now it
   * was only readable one trade at a time. Patterns could tell you that your
   * rushed trades lose money and there was no way to go and read them — which is
   * where the actual lesson is. Every tag the trader has ever applied is a filter
   * here, and every bar in Patterns links into it.
   */
  const byHash = new Map(notes.map((a) => [a.identityHash, a]));

  const oneOf = <T extends string>(raw: string | undefined, allowed: readonly T[]): T | null =>
    allowed.includes(raw as T) ? (raw as T) : null;

  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  // A specific date overrides the period window, or a calendar tap into an older
  // month would silently return nothing.
  const pool = onDate ? all.filter((t) => localDayKey(t.closedAt, timeZone) === onDate) : trades;

  // Tag filters are free text from the trader's own vocabulary, so they are
  // validated against what has actually been used rather than a fixed list.
  const used = <T,>(pick: (a: (typeof notes)[number]) => T | T[] | null | undefined): T[] => {
    const seen = new Set<T>();
    for (const a of notes) {
      const v = pick(a);
      for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== "") seen.add(x as T);
    }
    return [...seen];
  };
  const setupsUsed = used<string>((a) => a.setup).sort();
  const tfUsed = used<string>((a) => a.timeframe).sort();
  const emotionsUsed = used<string>((a) => a.emotion).sort();
  const mistakesUsed = used<string>((a) => a.mistakes).sort();
  const confluencesUsed = used<string>((a) => a.confluences).sort();

  const setup = oneOf(sp.setup, setupsUsed);
  const tf = oneOf(sp.tf, tfUsed);
  const emotion = oneOf(sp.emotion, emotionsUsed);
  const mistake = oneOf(sp.mistake, mistakesUsed);
  const confluence = oneOf(sp.confluence, confluencesUsed);
  const tagged = oneOf(sp.tagged, ["yes", "no"] as const);

  // A price band, as "low:high", so a level on the Patterns page can be opened.
  const band = /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(sp.level ?? "")
    ? (sp.level!.split(":").map(Number) as [number, number])
    : null;

  const news = oneOf(sp.news, ["in", "out"] as const);
  const result = oneOf(sp.result, RESULTS.map((r) => r.value));
  const shape = oneOf(sp.shape, SHAPES.map((s) => s.value));
  const day = oneOf(sp.day, WEEKDAYS);
  const sess = oneOf(sp.session, SESSIONS);
  const hold = oneOf(sp.hold, HOLDS);
  const dir = oneOf(sp.direction, DIRECTIONS.map((d) => d.value));
  /*
   * An hour, or a run of them.
   *
   * A single number is what the chip row offers. A range like "14-15" is what
   * the day-and-hour grid links with, because its cells cover two hours at a
   * time on a narrow screen and sending only half a cell's trades would be a
   * link that quietly lies about what it opens.
   */
  const hourMatch = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(sp.hour ?? "");
  const hourFrom = hourMatch ? Number(hourMatch[1]) : null;
  const hourTo = hourMatch ? Number(hourMatch[2] ?? hourMatch[1]) : null;
  const hour = hourFrom !== null && hourTo !== null && hourFrom < 24 && hourTo < 24 && hourTo >= hourFrom
    ? (hourTo === hourFrom ? String(hourFrom) : `${hourFrom}-${hourTo}`)
    : null;
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
  if (sess) filtered = filtered.filter((t) => sessionOf(t.openedAt) === sess);
  if (hour) {
    filtered = filtered.filter((t) => {
      const h = hourIn(t.openedAt, timeZone);
      return h >= hourFrom! && h <= hourTo!;
    });
  }
  if (hold) filtered = filtered.filter((t) => holdBucket(t.holdMinutes) === hold);
  if (dir) filtered = filtered.filter((t) => t.direction === dir);
  if (month) filtered = filtered.filter((t) => localDayKey(t.closedAt, timeZone).startsWith(month));
  if (setup) filtered = filtered.filter((t) => byHash.get(t.id)?.setup === setup);
  if (tf) filtered = filtered.filter((t) => byHash.get(t.id)?.timeframe === tf);
  if (emotion) filtered = filtered.filter((t) => byHash.get(t.id)?.emotion === emotion);
  if (mistake) filtered = filtered.filter((t) => byHash.get(t.id)?.mistakes?.includes(mistake));
  if (confluence) filtered = filtered.filter((t) => byHash.get(t.id)?.confluences?.includes(confluence));
  if (band) {
    const [lo, hi] = band;
    filtered = filtered.filter((t) =>
      (byHash.get(t.id)?.drawings ?? []).some((d) =>
        Math.min(d.low, d.high) <= hi && Math.max(d.low, d.high) >= lo));
  }
  if (news) {
    // Only loaded when the filter is on: a release calendar is shared by every
    // account here, and reading it to answer a question nobody asked would be
    // a crossing on every visit to this page.
    const span = pool.length
      ? await loadEvents(
          new Date(pool[pool.length - 1].openedAt.getTime() - 3600_000),
          new Date(pool[0].closedAt.getTime() + 3600_000),
        )
      : [];
    filtered = filtered.filter((t) => (newsWindow(t.openedAt, span).event !== null) === (news === "in"));
  }
  if (tagged) {
    const has = (t: ZoneTrade) => {
      const a = byHash.get(t.id);
      return !!(a && (a.note || a.setup || a.emotion || a.confluences?.length || a.mistakes?.length));
    };
    filtered = filtered.filter((t) => (tagged === "yes" ? has(t) : !has(t)));
  }

  const sorted = [...filtered].sort((a, b) =>
    sort === "oldest" ? a.closedAt.getTime() - b.closedAt.getTime()
    : sort === "best" ? b.netPnl - a.netPnl
    : sort === "worst" ? a.netPnl - b.netPnl
    : b.closedAt.getTime() - a.closedAt.getTime());

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      period, date: onDate, result, shape, day, session: sess, hour, hold,
      direction: dir, month, setup, tf, emotion, mistake, confluence, tagged,
      level: band ? sp.level! : null,
      news,
      sort: sort === "recent" ? null : sort,
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
      options: [
        // A range only ever arrives from the grid, so it is added to the list
        // just so the pill above can name it in words rather than echo "14-15".
        ...(hour && hour.includes("-")
          ? [{ value: hour, label: `${pad(hourFrom!)}:00 – ${pad(hourTo! + 1)}:00` }]
          : []),
        ...hoursUsed.map((h) => ({ value: String(h), label: `${pad(h)}:00` })),
      ] },
    { key: "hold", label: "How long you held", active: hold,
      options: HOLDS.map((h) => ({ value: h, label: h })) },
    ...(monthsUsed.length > 1
      ? [{ key: "month", label: "Month", active: month,
           options: monthsUsed.map((m) => ({ value: m, label: monthLabel(m) })) } as FilterGroup]
      : []),
    { key: "news", label: "Economic releases", active: news, options: [
        { value: "in", label: "Into the news" }, { value: "out", label: "Away from news" }] },
    ...(notes.length
      ? [{ key: "tagged", label: "Your notes", active: tagged, options: [
            { value: "yes", label: "Annotated" }, { value: "no", label: "Not annotated yet" }] } as FilterGroup]
      : []),
    ...tagGroup("setup", "Setup", setup, setupsUsed, (v) => v),
    ...tagGroup("tf", "Timeframe you read it on", tf, tfUsed, (v) => v),
    ...tagGroup("emotion", "How you felt", emotion, emotionsUsed, feelingLabel),
    ...tagGroup("mistake", "Mistake you tagged", mistake, mistakesUsed, mistakeLabel),
    ...tagGroup("confluence", "Confluence", confluence, confluencesUsed, confluenceLabel),
  ];

  const s = computeStats(sorted);
  const dayTotals = new Map<string, { net: number; n: number }>();
  for (const t of sorted) {
    const d = localDayKey(t.closedAt, timeZone);
    const x = dayTotals.get(d) ?? { net: 0, n: 0 };
    x.net += t.netPnl; x.n += 1;
    dayTotals.set(d, x);
  }
  const multiSymbol = new Set(sorted.map((t) => t.symbol)).size > 1;
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
          <Link href={`/day/${onDate}`} className="tap text-[13px] font-semibold">
            {new Date(`${onDate}T12:00:00Z`).toLocaleDateString("en-GB",
              { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} ›
          </Link>
          <Link href="/trades" className="tap text-[12.5px]" style={{ color: "var(--c1)" }}>Clear</Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
          <h1 className="text-[26px] font-semibold leading-none tracking-tight lg:text-[28px]">Trades</h1>
          <PeriodTabs base="/trades" active={period} />
        </div>
      )}

      {band && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
             style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
          <span className="text-[13px]">
            Trades where you marked{" "}
            <b className="num">{band[0].toFixed(2)} – {band[1].toFixed(2)}</b>
          </span>
          <Link href={href({ level: null })} className="tap text-[12.5px]" style={{ color: "var(--c1)" }}>Clear</Link>
        </div>
      )}

      <Filters groups={groups} href={href} showing={sorted.length} total={pool.length} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={[...SORTS]} active={sort} href={href} param="sort" />
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{count(sorted.length)}</span>
      </div>

      <StatGrid cols={4}>
        <Stat label="Net result" value={money(s.net)} tone={s.net >= 0 ? "pos" : "neg"} sub={count(s.n)} />
        <Stat label="Win rate" value={pct(s.winRate)} sub={`${s.wins} won · ${s.losses} lost`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"} />
        <Stat label="Made per $1 lost" value={s.profitFactor !== null ? `$${s.profitFactor.toFixed(2)}` : "—"} />
      </StatGrid>

      {shown.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-[15px] font-semibold">Nothing matches all of those</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[13px]" style={{ color: "var(--ink2)" }}>
            Remove one of the filters above and the list will fill back in.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {groupsOf(shown).map((g) => {
            const total = g.day ? dayTotals.get(g.day) : undefined;
            return (
              <section key={g.day ?? "all"} className="card overflow-hidden">
                {g.day && total && (
                  <Link href={`/day/${g.day}`}
                        className="row-link flex items-center gap-3 border-b px-4 py-2.5"
                        style={{ borderColor: "var(--line)", background: "var(--s2)" }}>
                    <span className="text-[13.5px] font-semibold">{dayHeading(g.day)}</span>
                    <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{count(total.n)}</span>
                    <span className={`num ml-auto text-[13.5px] font-semibold ${total.net >= 0 ? "pos" : "neg"}`}>
                      {money(total.net)}
                    </span>
                  </Link>
                )}
                <ul>
                  {g.trades.map((t, i) => {
                    const how = endedHow(t);
                    const weekend = heldOverWeekend(t.openedAt, t.closedAt);
                    const a = byHash.get(t.id);
                    const chips = [
                      a?.setup ? { text: a.setup, tone: "" } : null,
                      a?.emotion ? { text: feelingLabel(a.emotion), tone: "" } : null,
                      ...(a?.mistakes ?? []).slice(0, 2).map((m) => ({ text: mistakeLabel(m), tone: "chip-warn" })),
                      weekend ? { text: "Over a weekend", tone: "chip-warn" } : null,
                    ].filter((c): c is { text: string; tone: string } => !!c);
                    return (
                      <li key={t.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                        <Link href={`/trades/${t.id}`} className="row-link flex items-center gap-3 px-4 py-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold"
                                style={t.direction === "long"
                                  ? { background: "color-mix(in srgb, var(--c1) 12%, transparent)", color: "var(--c1)" }
                                  : { background: "color-mix(in srgb, var(--c2) 14%, transparent)", color: "var(--c2)" }}>
                            {t.direction === "long" ? "BUY" : "SELL"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="num text-[14px] font-semibold">
                                {g.day ? fmtTime.format(t.openedAt) : `${fmtDay.format(t.openedAt)}, ${fmtTime.format(t.openedAt)}`}
                              </span>
                              {multiSymbol && <span className="text-[12.5px] font-medium" style={{ color: "var(--ink2)" }}>{t.symbol}</span>}
                              {how && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{how}</span>}
                            </div>
                            <div className="num mt-0.5 truncate text-[12px]" style={{ color: "var(--ink3)" }}>
                              {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"}
                              {t.exitCount > t.legCount ? `, ${t.exitCount} exits` : ""} · {t.lots.toFixed(2)} lots ·{" "}
                              {t.holdMinutes < 1 ? "under a minute" : `${Math.round(t.holdMinutes)} min`}
                            </div>
                            {chips.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {chips.slice(0, 3).map((c) => <span key={c.text} className={`chip ${c.tone}`}>{c.text}</span>)}
                              </div>
                            )}
                          </div>
                          <span className={`num shrink-0 text-[14.5px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
                            {money(t.netPnl)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          {safePage > 1
            ? <Link href={href({ page: String(safePage - 1) })} className="btn btn-secondary">Newer</Link>
            : <span />}
          <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Page {safePage} of {pages}</span>
          {safePage < pages
            ? <Link href={href({ page: String(safePage + 1) })} className="btn btn-secondary">Older</Link>
            : <span />}
        </div>
      )}
    </div>
  );

  /*
   * By day when the list is in time order, because that is how a trader
   * remembers trades — "Thursday, after the CPI" — and a day's total is the
   * first thing they want next to it. By result, grouping would scatter one
   * day across the whole list, so it stays flat and each row carries its date.
   */
  function groupsOf(list: ZoneTrade[]): { day: string | null; trades: ZoneTrade[] }[] {
    if (sort !== "recent" && sort !== "oldest") return [{ day: null, trades: list }];
    const out: { day: string; trades: ZoneTrade[] }[] = [];
    for (const t of list) {
      const d = localDayKey(t.closedAt, timeZone);
      if (out.length && out[out.length - 1].day === d) out[out.length - 1].trades.push(t);
      else out.push({ day: d, trades: [t] });
    }
    return out;
  }
}

function dayHeading(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB",
    { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** A filter group only appears once the trader has used that vocabulary at all. */
function tagGroup(
  key: string, label: string, active: string | null,
  values: string[], toLabel: (v: string) => string,
): FilterGroup[] {
  if (values.length < 2) return [];
  return [{ key, label, active, options: values.map((v) => ({ value: v, label: toLabel(v) })) }];
}
