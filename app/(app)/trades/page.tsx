import Link from "next/link";
import { computeStats, hourIn } from "@/lib/core/metrics";
import { sessionOf, weekdayIn } from "@/lib/core/analysis";
import { localDayKey } from "@/lib/core/metrics";
import { loadTrades, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { Card, Empty, Stat, StatGrid, count, money, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "laddered", label: "Laddered" },
  { key: "scaled", label: "Scaled out" },
  { key: "stop", label: "Had a stop" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function applyFilter(trades: ZoneTrade[], f: FilterKey) {
  switch (f) {
    case "won": return trades.filter((t) => t.netPnl > 0);
    case "lost": return trades.filter((t) => t.netPnl < 0);
    case "laddered": return trades.filter((t) => t.legCount > 1);
    case "scaled": return trades.filter((t) => t.exitCount > t.legCount);
    case "stop": return trades.filter((t) => t.hadStop);
    default: return trades;
  }
}

/** Plain words for how the trade ended — "so" and "tp" mean nothing to a reader. */
function endedHow(t: ZoneTrade): string | null {
  if (t.closeReasons.includes("so")) return "Margin call";
  if (t.closeReasons.includes("tp")) return "Hit target";
  if (t.closeReasons.includes("sl")) return "Hit stop";
  return null;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const SESSIONS = ["Asia", "London", "New York", "Late"] as const;

export default async function Trades({ searchParams }: {
  searchParams: Promise<{ period?: string; filter?: string; page?: string; day?: string; session?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const period = resolvePeriod(sp.period);
  const filter = (FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all") as FilterKey;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const PER = 100;

  const { all, trades, timeZone, isEmpty } = await loadTrades(period);
  if (isEmpty) {
    return <Empty title="No trades yet" body="Import a broker CSV and every trade shows up here." />;
  }

  const day = WEEKDAYS.includes(sp.day as typeof WEEKDAYS[number]) ? sp.day! : null;
  const sess = SESSIONS.includes(sp.session as typeof SESSIONS[number]) ? sp.session! : null;

  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  // A specific date overrides the period window, or a calendar tap into an older
  // month would silently return nothing.
  const pool = onDate ? all.filter((t) => localDayKey(t.closedAt, timeZone) === onDate) : trades;
  let filtered = applyFilter(pool, filter);
  if (day) filtered = filtered.filter((t) => weekdayIn(t.openedAt, timeZone) === day);
  if (sess) filtered = filtered.filter((t) => sessionOf(hourIn(t.openedAt, timeZone)) === sess);
  const qs = (o: Record<string, string | null>) => {
    const p = new URLSearchParams({ period, filter });
    if (day) p.set("day", day);
    if (onDate) p.set("date", onDate);
    if (sess) p.set("session", sess);
    for (const [k, v] of Object.entries(o)) v === null ? p.delete(k) : p.set(k, v);
    return `/trades?${p.toString()}`;
  };
  const s = computeStats(filtered);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice((page - 1) * PER, page * PER);

  const fmtDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone });
  const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

  return (
    <div className="space-y-4">
      {onDate && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
             style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
          <span className="text-[13px] font-semibold">
            {new Date(`${onDate}T12:00:00Z`).toLocaleDateString("en-GB",
              { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          </span>
          <Link href="/trades" className="text-[12.5px]" style={{ color: "var(--c1)" }}>Clear</Link>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ display: onDate ? "none" : undefined }}>
        <PeriodTabs base="/trades" active={period} />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>times in your local time</span>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Link key={f.key} href={qs({ filter: f.key, page: null })} scroll={false}
                  className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
                  style={on
                    ? { background: "var(--ink)", color: "var(--plane)" }
                    : { background: "var(--s1)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {WEEKDAYS.map((d) => (
          <Link key={d} href={qs({ day: day === d ? null : d, page: null })} scroll={false}
                className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={day === d
                  ? { background: "var(--c1)", color: "#fff" }
                  : { background: "var(--s1)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
            {d.slice(0, 3)}
          </Link>
        ))}
        <span className="shrink-0 self-center px-1" style={{ color: "var(--line)" }}>|</span>
        {SESSIONS.map((x) => (
          <Link key={x} href={qs({ session: sess === x ? null : x, page: null })} scroll={false}
                className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={sess === x
                  ? { background: "var(--c1)", color: "#fff" }
                  : { background: "var(--s1)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
            {x}
          </Link>
        ))}
      </div>

      <StatGrid cols={3}>
        <Stat label="Net result" value={money(s.net)} tone={s.net >= 0 ? "pos" : "neg"} sub={count(s.n)} />
        <Stat label="Won" value={pct(s.winRate)} sub={`${s.wins} won, ${s.losses} lost`} />
        <Stat label="Average trade" value={money(s.expectancy)} tone={s.expectancy >= 0 ? "pos" : "neg"} />
      </StatGrid>

      <Card className="!p-0">
        <ul>
          {shown.map((t, i) => {
            const how = endedHow(t);
            return (
              <li key={t.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                <Link href={`/trades/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                <span className="h-7 w-1 shrink-0 rounded-full"
                      style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-[13.5px] font-semibold">
                    <span>{t.direction === "long" ? "Bought" : "Sold"} {t.symbol}</span>
                    {how && (
                      <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                            style={{ background: "var(--s3)", color: "var(--ink2)" }}>{how}</span>
                    )}
                  </div>
                  <div className="num mt-0.5 truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                    {fmtDay.format(t.openedAt)} {fmtTime.format(t.openedAt)} ·{" "}
                    {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"}
                    {t.exitCount > t.legCount ? `, ${t.exitCount} exits` : ""} ·{" "}
                    {t.lots.toFixed(2)} lots · {t.holdMinutes < 1 ? "under a minute" : `${Math.round(t.holdMinutes)} min`}
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

      {pages > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          {page > 1
            ? <Link href={qs({ page: String(page - 1) })} style={{ color: "var(--c1)" }}>← Newer</Link>
            : <span />}
          <span style={{ color: "var(--ink3)" }}>Page {page} of {pages}</span>
          {page < pages
            ? <Link href={qs({ page: String(page + 1) })} style={{ color: "var(--c1)" }}>Older →</Link>
            : <span />}
        </div>
      )}
    </div>
  );
}
