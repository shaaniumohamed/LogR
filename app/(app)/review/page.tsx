import Link from "next/link";
import { loadAnnotations } from "@/lib/actions";
import { loadTrades } from "@/lib/queries";
import { requireContext } from "@/lib/session";
import { localDayKey } from "@/lib/core/metrics";
import { confluenceLabel, feelingLabel, mistakeLabel } from "@/lib/core/taxonomy";
import { heldOverWeekend } from "@/lib/core/analysis";
import { Card, Empty, Eyebrow, Note, Verdict, count, money, pct } from "@/components/ui";
import { Info } from "@/components/info";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

/**
 * How far back to look.
 *
 * Anchored to the real calendar rather than to the newest imported trade,
 * because reviewing is something done on a rhythm — tonight, this week, this
 * month — and a "this week" that silently meant the week of whatever was last
 * imported would answer a question nobody asked.
 */
const SPANS = [
  { key: "latest", label: "Latest day" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "Everything" },
] as const;
type SpanKey = (typeof SPANS)[number]["key"];

function spanStart(span: SpanKey, timeZone: string): Date | null {
  if (span === "all" || span === "latest") return null;
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const today = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  if (span === "month") return new Date(Date.UTC(+parts.year, +parts.month - 1, 1));
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const back = Math.max(0, order.indexOf(parts.weekday));
  return new Date(today - back * 86_400_000);
}

export default async function Review({ searchParams }: {
  searchParams: Promise<{ tab?: string; span?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "done" ? "done" : "todo";
  const span = (SPANS.some((s) => s.key === sp.span) ? sp.span : "all") as SpanKey;
  const q = (sp.q ?? "").trim().slice(0, 80);

  const { account } = await requireContext();
  const [{ all, timeZone, isEmpty }, annotations] = await Promise.all([
    loadTrades("all"),
    loadAnnotations(account.id),
  ]);
  if (isEmpty) return <Empty title="Nothing to review" body="Import your trade history first." />;
  const byHash = new Map(annotations.map((a) => [a.identityHash, a]));

  /*
   * "Latest day" is not a calendar span and cannot be one.
   *
   * The others answer "what have I done lately"; this answers "what did I just
   * do", which is the review that actually gets done — the one at the end of the
   * session, before the day has blurred. It is anchored to the newest trade
   * rather than to today, because the last session was probably Friday and a
   * button that empties itself over the weekend is a button nobody trusts.
   */
  const latestDay = all.length ? localDayKey(all[0].closedAt, timeZone) : null;
  const from = spanStart(span, timeZone);
  const inSpan =
    span === "latest"
      ? all.filter((t) => localDayKey(t.closedAt, timeZone) === latestDay)
      : from
        ? all.filter((t) => t.closedAt >= from)
        : all;

  /*
   * A row exists the moment anything is saved against a trade, including an
   * empty mark-up, so its presence is not proof that anything was written. Only
   * count a trade reviewed when it actually carries something the trader put
   * there — otherwise the progress bar congratulates them for a stray tap.
   */
  const written = (a: (typeof annotations)[number] | undefined) =>
    !!a && !!(a.setup || a.emotion || a.note || a.invalidation
      || a.confluences?.length || a.mistakes?.length || a.drawings?.length);

  const pending = inSpan.filter((t) => !written(byHash.get(t.id)));
  const reviewed = inSpan.filter((t) => written(byHash.get(t.id)));

  /**
   * Biggest absolute result first, not newest first.
   *
   * With hundreds untagged, date order guarantees the trader stops before
   * reaching anything that matters. The largest winners and losers carry nearly
   * all the explanatory signal.
   */
  const queue = [...pending].sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl)).slice(0, 25);
  /*
   * Search runs over what the trader wrote, not over the broker's fields. That
   * is the only part of a journal a person actually remembers by phrase — "the
   * one where I said I was chasing" — and without it a long history is a place
   * notes go to be lost.
   */
  const needle = q.toLowerCase();
  const matches = (t: ZoneTrade) => {
    if (!needle) return true;
    const a = byHash.get(t.id);
    if (!a) return false;
    const hay = [a.note, a.setup, a.timeframe, a.emotion,
                 ...(a.confluences ?? []), ...(a.mistakes ?? []),
                 ...(a.drawings ?? []).map((d) => d.label)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(needle);
  };
  const found = reviewed.filter(matches);
  const done = [...found].sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime()).slice(0, 50);

  const pctDone = inSpan.length ? reviewed.length / inSpan.length : 0;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  const href = (next: { tab?: string; span?: string; q?: string }) => {
    const p = new URLSearchParams({ tab: next.tab ?? tab, span: next.span ?? span });
    const term = next.q ?? q;
    if (term) p.set("q", term);
    return `/review?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--s3)" }}>
          {([["todo", `To review${pending.length ? ` · ${pending.length}` : ""}`],
             ["done", `Reviewed${reviewed.length ? ` · ${reviewed.length}` : ""}`]] as const).map(([k, label]) => (
            <Link key={k} href={href({ tab: k })} scroll={false}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-medium"
                  style={tab === k ? { background: "var(--ink)", color: "var(--plane)" } : { color: "var(--ink2)" }}>
              {label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {SPANS.map((s) => (
            <Link key={s.key} href={href({ span: s.key })} scroll={false}
                  className="rounded-lg px-2.5 py-1.5 text-[12px]"
                  style={span === s.key
                    ? { background: "var(--s3)", color: "var(--ink)", fontWeight: 600 }
                    : { color: "var(--ink3)" }}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <Eyebrow>Annotation progress</Eyebrow>
        <Verdict>
          {inSpan.length === 0
            ? `No trades ${span === "week" ? "this week" : span === "month" ? "this month" : "in this period"} yet.`
            : reviewed.length === 0
              ? `None of these ${inSpan.length} trades are annotated yet. You do not need to do them all.`
              : `${reviewed.length} of ${inSpan.length} annotated.`}
        </Verdict>
        <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
          <div className="h-full rounded-full"
               style={{ width: `${Math.max(1.5, pctDone * 100)}%`, background: "var(--profit)" }} />
        </div>
        <Info title="Why not annotate everything?">
          Your biggest winners and losers explain most of what happened; the hundreds of
          near-scratch trades in the middle mostly add noise. The queue is sorted by size of
          result rather than by date, so the twenty at the top are worth more than two hundred
          picked at random.
          <br /><br />
          Everything you tag feeds <b>Patterns</b>, which is where the answers come out — which
          setups pay, which states of mind cost you, which mistakes are expensive.
        </Info>
      </Card>

      {tab === "todo" ? (
        queue.length === 0 ? (
          <Empty title="All caught up"
                 body={span === "all"
                   ? "Every trade has been annotated. New imports will appear here."
                   : "Nothing left to annotate in this period."} />
        ) : (
          <Card className="!p-0">
            <div className="px-4 pt-4">
              <Eyebrow>Worth annotating first</Eyebrow>
              <Note>Your largest results, biggest first. Each takes under a minute.</Note>
            </div>
            <ul className="mt-3">
              {queue.map((t, i) => (
                <TradeRow key={t.id} t={t} n={i + 1} fmt={fmt} from="review" />
              ))}
            </ul>
            {pending.length > queue.length && (
              <div className="px-4 py-3 text-center text-[12px]"
                   style={{ borderTop: "1px solid var(--line)", color: "var(--ink3)" }}>
                {count(pending.length - queue.length)} more waiting
              </div>
            )}
          </Card>
        )
      ) : (
        <>
          <form action="/review" method="get" className="flex gap-2">
            <input type="hidden" name="tab" value="done" />
            <input type="hidden" name="span" value={span} />
            <input name="q" defaultValue={q} placeholder="Search your notes and tags"
                   className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-[13px]"
                   style={{ background: "var(--s1)", border: "1px solid var(--line)", color: "var(--ink)" }} />
            <button type="submit" className="rounded-lg px-3.5 py-2.5 text-[13px] font-semibold"
                    style={{ background: "var(--ink)", color: "var(--plane)" }}>Search</button>
            {q && (
              <Link href={href({ q: "" })} className="self-center text-[12.5px]" style={{ color: "var(--c1)" }}>
                Clear
              </Link>
            )}
          </form>
          {done.length === 0 ? (
            <Empty
              title={q ? `Nothing matches “${q}”` : "Nothing annotated yet"}
              body={q
                ? "Search looks through your notes, setups, feelings, mistakes and the names you gave your chart mark-up."
                : "Trades you annotate show up here, with what you tagged, so you can come back and read your own reasoning."} />
          ) : (
        <Card className="!p-0">
          <div className="px-4 pt-4">
            <Eyebrow>What you have written down</Eyebrow>
            <Note>
              Newest first. Tap any of them to re-read or change what you wrote — nothing is
              locked once it is saved.
            </Note>
          </div>
          <ul className="mt-3">
            {done.map((t) => {
              const a = byHash.get(t.id)!;
              const tags = [
                a.setup, a.timeframe,
                a.emotion ? feelingLabel(a.emotion) : null,
                ...(a.confluences ?? []).slice(0, 2).map(confluenceLabel),
                ...(a.mistakes ?? []).map(mistakeLabel),
              ].filter(Boolean) as string[];
              return (
                <li key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <Link href={`/trades/${t.id}?from=review`} className="block px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-7 w-1 shrink-0 rounded-full"
                            style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold">
                          {t.direction === "long" ? "Bought" : "Sold"} {t.symbol}
                          {heldOverWeekend(t.openedAt, t.closedAt) && (
                            <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide align-middle"
                                  style={{ color: "var(--warn)", border: "1px solid var(--warn)" }}>weekend</span>
                          )}
                        </div>
                        <div className="num truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                          {fmt.format(t.openedAt)}
                        </div>
                      </div>
                      <span className={`num shrink-0 text-[14px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
                        {money(t.netPnl)}
                      </span>
                    </div>
                    {tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((tag, i) => (
                          <span key={`${tag}-${i}`} className="rounded-full px-2 py-0.5 text-[11px]"
                                style={{ background: "var(--s3)", color: "var(--ink2)" }}>{tag}</span>
                        ))}
                      </div>
                    )}
                    {a.note && (
                      <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug" style={{ color: "var(--ink2)" }}>
                        {a.note}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-3 text-center text-[12px]" style={{ borderTop: "1px solid var(--line)" }}>
            <Link href="/analytics" style={{ color: "var(--c1)" }}>
              See what these add up to in Patterns ›
            </Link>
          </div>
        </Card>
          )}
        </>
      )}
    </div>
  );
}

function TradeRow({ t, n, fmt, from }: {
  t: ZoneTrade; n: number; fmt: Intl.DateTimeFormat; from: string;
}) {
  return (
    <li style={{ borderTop: "1px solid var(--line)" }}>
      <Link href={`/trades/${t.id}?from=${from}`} className="flex items-center gap-3 px-4 py-3">
        <span className="num w-5 shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{n}</span>
        <span className="h-7 w-1 shrink-0 rounded-full"
              style={{ background: t.netPnl >= 0 ? "var(--profit)" : "var(--loss)" }} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">
            {t.direction === "long" ? "Bought" : "Sold"} {t.symbol}
            {heldOverWeekend(t.openedAt, t.closedAt) && (
              <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide align-middle"
                    style={{ color: "var(--warn)", border: "1px solid var(--warn)" }}>weekend</span>
            )}
          </div>
          <div className="num truncate text-[11px]" style={{ color: "var(--ink3)" }}>
            {fmt.format(t.openedAt)} · {t.legCount > 1 ? `${t.legCount} entries` : "1 entry"} ·{" "}
            {t.lots.toFixed(2)} lots
          </div>
        </div>
        <span className={`num shrink-0 text-[14px] font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>
          {money(t.netPnl)}
        </span>
        <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
      </Link>
    </li>
  );
}
