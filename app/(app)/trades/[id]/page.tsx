import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAnnotation } from "@/lib/actions";
import { loadTradeWithLegs, loadTrades } from "@/lib/queries";
import { TradeChart } from "@/components/trade-chart";
import { closureGap, contextWindow, fetchWindow, loadBars } from "@/lib/candles";
import { coversFills } from "@/lib/core/window";
import { localDayKey } from "@/lib/core/metrics";
import { dayLabel } from "@/lib/core/calendar";
import { heldOverWeekend } from "@/lib/core/analysis";
import { ChartPanel } from "./chart-panel";
import { GetCandles } from "./get-candles";
import { Card, Eyebrow, Note, Stat, StatGrid, Verdict, money, pct } from "@/components/ui";
import { Info } from "@/components/info";
import { AnnotateForm } from "./annotate-form";

export const dynamic = "force-dynamic";

export default async function TradeDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const { all, account, timeZone } = await loadTrades("all");

  const t = all.find((x) => x.id === id);
  if (!t) notFound();

  const existing = (await loadAnnotation(account.id, id)) ?? null;
  const withLegs = await loadTradeWithLegs(account.id, id);

  // Candles for a window around the trade, if any have been imported. Loaded at
  // one minute and rolled up in the browser, so the timeframe buttons are free.
  const { from: barsFrom, to: barsTo } = contextWindow(t.openedAt, t.closedAt);
  const bars = await loadBars(t.symbol, barsFrom, barsTo);
  // Whole days, so one call covers every other trade taken that day too.
  const toFetch = fetchWindow(t.openedAt, t.closedAt);

  // Only measured when the clock already says a closure was spanned, so the
  // longest silence in the bars is that closure and not a hole in the imports.
  const overWeekend = heldOverWeekend(t.openedAt, t.closedAt);
  const gap = overWeekend ? await closureGap(t.symbol, t.openedAt, t.closedAt) : null;
  const againstYou = gap ? (t.direction === "long" ? -gap.points : gap.points) : 0;

  const fills = (withLegs?.legs ?? []).flatMap((l) => [
    { kind: "in" as const, time: Math.floor(l.openedAt.getTime() / 1000), price: l.openPrice, lots: l.lots, profit: l.profit },
    { kind: "out" as const, time: Math.floor(l.closedAt.getTime() / 1000), price: l.closePrice, lots: l.lots, profit: l.profit },
  ]);

  /*
   * Whether the candles we hold actually cover THIS trade, rather than merely
   * existing. Holding some bars for the window is not the same as being able to
   * draw the entry: a half-filled day, a fetch that stopped short, or a window
   * that begins after the first fill all leave a chart that renders perfectly
   * and is missing the part being reviewed. Measured against the fills, so the
   * answer is a sentence the trader can act on rather than a blank rectangle.
   */
  const coverage = coversFills(bars, fills);
  const dayKey = localDayKey(t.closedAt, timeZone);

  // Proposed from the zone's own geometry: just beyond the far edge of where the
  // entries filled. The trader confirms or corrects it — a proposal they only
  // have to accept is far likelier to get answered than an empty box.
  const pad = Math.max(0.35, (t.zoneHigh - t.zoneLow) * 0.6);
  const suggested = t.direction === "long" ? t.zoneLow - pad : t.zoneHigh + pad;

  const risk = Math.abs(t.avgEntry - (existing?.invalidation ?? suggested)) * 100 * t.lots;
  const rMultiple = risk > 0 ? t.netPnl / risk : null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  // Queue position, so "save and next" can walk the unannotated backlog.
  const next = from === "review" ? "/review" : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <Link href={`/day/${dayKey}`} style={{ color: "var(--ink2)" }}>
          ‹ {dayLabel(dayKey, { weekday: "short", day: "numeric", month: "short" })}
        </Link>
        <Link href="/trades" style={{ color: "var(--ink3)" }}>All trades</Link>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>{t.direction === "long" ? "Bought" : "Sold"} {t.symbol}</Eyebrow>
            <div className="num mt-1 text-[13px]" style={{ color: "var(--ink2)" }}>{fmt.format(t.openedAt)}</div>
          </div>
          <div className={`num text-2xl font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>{money(t.netPnl)}</div>
        </div>

        <div className="mt-4">
          <StatGrid cols={4}>
            <Stat label="Entries" value={String(t.legCount)}
                  sub={t.exitCount > t.legCount ? `${t.exitCount} exits` : "1 exit each"} />
            <Stat label="Size" value={`${t.lots.toFixed(2)} lots`} />
            <Stat label="Held" value={t.holdMinutes < 1 ? "<1 min" : `${Math.round(t.holdMinutes)} min`} />
            <Stat label="Result in R" value={rMultiple !== null ? `${rMultiple > 0 ? "+" : "−"}${Math.abs(rMultiple).toFixed(2)}R` : "—"}
                  tone={(rMultiple ?? 0) >= 0 ? "pos" : "neg"}
                  sub={existing?.invalidation ? "measured" : "estimated"} />
          </StatGrid>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          {[["Average entry", t.avgEntry.toFixed(2)], ["Average exit", t.avgExit.toFixed(2)],
            ["Zone", `${t.zoneLow.toFixed(2)} – ${t.zoneHigh.toFixed(2)}`],
            ["Risked", `$${risk.toFixed(2)}`]].map(([k, v]) => (
            <div key={k}>
              <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{k}</div>
              <div className="num font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <Info title="What does R mean?">
          <b>R stands for risk, not reward.</b> It is the amount you stood to lose if the idea
          failed. A result of +2R means you made twice what you were risking; −1R means you
          lost exactly what you were risking.
          <br /><br />
          It matters because dollars are not comparable across trades — a $40 win on a big
          position and a $40 win on a small one are very different achievements. R puts every
          trade on the same scale. It needs one input from you: the price at which the idea
          was dead.
        </Info>
      </Card>

      {overWeekend && (
        <Card className="!border-[color:var(--warn)]">
          <Eyebrow>Held through the weekend</Eyebrow>
          <Verdict>
            {gap
              ? `The market was shut for ${Math.round(gap.hoursShut)} hours in the middle of this trade, and reopened ${Math.abs(gap.points).toFixed(2)} ${againstYou > 0 ? "against" : "in favour of"} you.`
              : "This position was open while the market was shut for the weekend."}
          </Verdict>
          {gap && (
            <div className="mt-3">
              <StatGrid cols={3}>
                <Stat label="Last price Friday" value={gap.before.toFixed(2)} />
                <Stat label="First price after" value={gap.after.toFixed(2)} />
                <Stat label="Gap" value={`${gap.points > 0 ? "+" : "−"}${Math.abs(gap.points).toFixed(2)}`}
                      tone={againstYou > 0 ? "neg" : "pos"}
                      sub={againstYou > 0 ? "against you" : "in your favour"} />
              </StatGrid>
            </div>
          )}
          <Info title="Why this is its own category">
            A position held through a closure is not the trade you entered. There is no
            managing it, no respecting an invalidation, no taking a partial — it reopens
            wherever the world decided over two days, and the first price you can act on may
            be a long way from the last one you saw.
            <br /><br />
            That makes the outcome something other than a read on your setup, which is why it
            is separated out in Patterns rather than averaged in with everything else. It is
            detected from the clock, so it needs no tagging from you.
          </Info>
        </Card>
      )}

      {withLegs && withLegs.legs.length > 0 && (
        <Card>
          <Eyebrow>How it played out</Eyebrow>
          {coverage.covered > 0 ? (
            <>
              <Note>
                Real price, with every entry and exit where it actually happened. Mark the
                zones and levels you were trading — they save with the trade.
              </Note>
              {!coverage.complete && (
                <div className="mt-3 rounded-lg p-3 text-[12.5px] leading-relaxed"
                     style={{ background: "var(--s3)", borderLeft: "3px solid var(--warn)", color: "var(--ink2)" }}>
                  <b>
                    {coverage.total - coverage.covered} of your {coverage.total} fills have no candle
                    behind them.
                  </b>{" "}
                  The chart below is real as far as it goes, but part of this trade is not on it.
                  Fetching this day fills the gap.
                  <GetCandles symbol={t.symbol} hasKey={!!process.env.TWELVEDATA_API_KEY}
                              from={toFetch.from.toISOString()} to={toFetch.to.toISOString()} />
                </div>
              )}
              <div className="mt-3">
                <ChartPanel
                  identityHash={t.id}
                  bars={bars}
                  fills={fills}
                  timeZone={timeZone}
                  symbol={t.symbol}
                  zoneFromFills={{ low: t.zoneLow, high: t.zoneHigh }}
                  invalidation={existing?.invalidation ?? null}
                  initialDrawings={existing?.drawings ?? []}
                />
              </div>
              <Info title="How to read this">
                The blue arrows are your entries and the circles are your exits, each at the
                exact price it filled — green where that exit made money, red where it lost.
                The solid blue band is the range your ladder actually filled into; it is drawn
                from your fills, not from anything you typed.
                <br /><br />
                Your own mark-up appears as dashed gold bands. Draw the level you were trading
                and the zone your fills landed in becomes something you can compare it against:
                did you get filled where you meant to, or did you chase?
                <br /><br />
                The red dashed line is your invalidation, set in the form below.
              </Info>
            </>
          ) : (
            <>
              <Note>
                Every entry and exit, plotted against price and time.
              </Note>
              <div className="mt-3">
                <TradeChart legs={withLegs.legs} zoneLow={t.zoneLow} zoneHigh={t.zoneHigh}
                            invalidation={existing?.invalidation ?? null}
                            direction={t.direction} timeZone={timeZone} />
              </div>
              <GetCandles symbol={t.symbol} hasKey={!!process.env.TWELVEDATA_API_KEY}
                          from={toFetch.from.toISOString()} to={toFetch.to.toISOString()} />
              <Info title="Why there are no candles here">
                Your broker export contains your fills, not the market&rsquo;s price history — so
                this shows exactly where you entered and exited, but not what price did in
                between.
                <br /><br />
                Fetching pulls the whole day in one go, so every other trade you took that day
                gets its chart at the same time. Failing that, the{" "}
                <b>Import → Price history</b> screen takes a CSV.
              </Info>
            </>
          )}
        </Card>
      )}

      <Card>
        <Eyebrow>Annotate this trade</Eyebrow>
        <Note>
          Everything above came from your broker automatically. This part is the half only you
          know — and it is what turns a list of results into something that can tell you why.
        </Note>
        <div className="mt-4">
          <AnnotateForm identityHash={t.id} existing={existing} suggestedInvalidation={suggested} nextHref={next} />
        </div>
      </Card>
    </div>
  );
}
