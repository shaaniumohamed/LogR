import Link from "next/link";
import { computeStats, segmentBy, hourIn } from "@/lib/core/metrics";
import { loadAnnotations } from "@/lib/actions";
import { FEELINGS, MISTAKES, confluenceLabel, feelingLabel, isGoodFeeling, mistakeLabel } from "@/lib/core/taxonomy";
import { Info, Caveat } from "@/components/info";
import { holdBucket, hourWeekdayGrid, sessionOf, weekdayIn, counterfactual, heldOverWeekend } from "@/lib/core/analysis";
import { distribution } from "@/lib/core/distribution";
import { tiltProfile } from "@/lib/core/tilt";
import { clusterLevels, type Mark } from "@/lib/core/levels";
import { loadExits, loadTrades, resolvePeriod } from "@/lib/queries";
import { requireContext } from "@/lib/session";
import { PeriodTabs } from "@/components/period-tabs";
import { zoneName } from "@/lib/timezones";
import { BarChart, Heatmap, Histogram, type BarRow } from "@/components/charts";
import { Card, Empty, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const MIN = 10; // below this a bucket says nothing, so it is not drawn at all

/**
 * Bars for a grouping, each one a link to the trades inside it.
 *
 * `linkFor` is what turns this page from a set of conclusions into something a
 * trader can interrogate. "Your rushed trades cost four hundred dollars" is only
 * the start of the thought; the rest of it is in the twelve trades themselves,
 * and until they were one tap away nobody was going to go and find them.
 */
function rowsFor(
  trades: ZoneTrade[],
  key: (t: ZoneTrade) => string | null,
  minN = MIN,
  linkFor?: (groupKey: string) => string,
): BarRow[] {
  return segmentBy(trades, key, minN)
    .sort((a, b) => b.stats.net - a.stats.net)
    .map((g) => ({
      label: g.key,
      value: g.stats.net,
      meta: `${count(g.stats.n)} · won ${pct(g.stats.winRate, 0)}`,
      href: linkFor?.(g.key),
    }));
}

/** Patterns and Trades share one period, so a drill-down lands on the same slice. */
const drill = (period: string, params: Record<string, string>) =>
  `/trades?${new URLSearchParams({ period, ...params }).toString()}`;

/** A section only renders if it has something to say. Empty charts are noise. */
function Section({ title, verdict, rows, note, info }: {
  title: string; verdict: string; rows: BarRow[]; note?: React.ReactNode; info?: React.ReactNode;
}) {
  if (rows.length < 2) return null;
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <Verdict>{verdict}</Verdict>
      <BarChart rows={rows} format={(v) => money0(v)} />
      {note && <Note>{note}</Note>}
      {info && <Info>{info}</Info>}
    </Card>
  );
}

/**
 * One measurement, after a win against after a loss.
 *
 * Two bars on a shared scale rather than three numbers in a row, because the
 * only thing being asked is which is bigger and by how much — and `worseWhen`
 * decides which direction earns the alarming colour, since re-entering sooner
 * is the bad direction for a delay and later is the bad direction for a result.
 */
function TiltRow({ label, win, loss, big, format, worseWhen }: {
  label: string; win: number; loss: number; big: number | null;
  format: (v: number) => string; worseWhen: "higher" | "lower";
}) {
  const rows = [
    { name: "after a win", v: win },
    { name: "after a loss", v: loss },
    ...(big !== null ? [{ name: "after a big loss", v: big }] : []),
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), 0.0001);
  const worse = worseWhen === "higher" ? loss > win * 1.1 : loss < win * 0.9;

  /*
   * A measurement that can go negative is drawn from a centre line.
   *
   * Otherwise the bars race on absolute size and the longest one wins, which on
   * "what the next trade made" put the biggest bar against the worst number. A
   * reader glancing at that learns the opposite of what happened.
   */
  const diverging = rows.some((r) => r.v < 0) && rows.some((r) => r.v >= 0)
    || rows.every((r) => r.v < 0);

  return (
    <div>
      <div className="text-[12.5px] font-semibold">{label}</div>
      <div className="mt-1.5 space-y-1">
        {rows.map((r, i) => {
          const colour = i === 0 ? "var(--ink3)"
            : diverging ? (r.v >= 0 ? "var(--profit)" : "var(--loss)")
            : worse ? "var(--loss)" : "var(--c1)";
          return (
            <div key={r.name} className="flex items-center gap-2">
              <span className="w-[92px] shrink-0 text-[11px]" style={{ color: "var(--ink3)" }}>{r.name}</span>
              <div className="relative h-3 flex-1">
                {diverging && (
                  <span className="absolute inset-y-0 left-1/2 w-px"
                        style={{ background: "var(--ink3)", opacity: 0.45 }} />
                )}
                <span className="absolute top-0 h-full rounded-[3px]"
                      style={{
                        width: `${(Math.abs(r.v) / max) * (diverging ? 50 : 100)}%`,
                        background: colour,
                        opacity: i === 2 ? 0.8 : 1,
                        ...(diverging
                          ? r.v >= 0 ? { left: "50%" } : { right: "50%" }
                          : { left: 0 }),
                      }} />
              </div>
              <span className="num w-[70px] shrink-0 text-right text-[12px] font-semibold">{format(r.v)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ENDED_LABEL: Record<string, string> = {
  user: "You closed it",
  tp: "Target was hit",
  sl: "Stop was hit",
  so: "Margin call",
  unknown: "Not recorded",
};

export default async function Analytics({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const period = resolvePeriod((await searchParams).period);
  const { account } = await requireContext();
  // Independent reads, started together — see the note on the trade page.
  const [{ trades, timeZone, isEmpty }, annotations, exits] = await Promise.all([
    loadTrades(period),
    loadAnnotations(account.id),
    loadExits(account.id, period),
  ]);

  if (isEmpty) {
    return <Empty title="Nothing to analyse yet" body="Import your broker history and the patterns appear here automatically — nothing to fill in." />;
  }

  const s = computeStats(trades);

  // Annotation-backed analysis. These sections stay hidden until there is enough
  // tagged data to say anything, rather than showing an empty chart that implies
  // the trader has no patterns when in fact they have not tagged any trades yet.
  const byHash = new Map(annotations.map((a) => [a.identityHash, a]));
  const tagged = trades.filter((t) => byHash.has(t.id));
  const ANNOT_MIN = 15;
  const hasEnough = tagged.length >= ANNOT_MIN;

  // Grouped by the label a reader sees, then linked back by the stored key, so
  // the chart speaks English and the filter still matches what is in the database.
  const feelingKeys = new Map(FEELINGS.map((f) => [f.label as string, f.key as string]));
  const mistakeKeys = new Map(MISTAKES.map((m) => [m.label as string, m.key as string]));

  const feelingRows = hasEnough
    ? rowsFor(tagged, (t) => { const f = byHash.get(t.id)?.emotion; return f ? feelingLabel(f) : null; }, 5,
        (label) => drill(period, { emotion: feelingKeys.get(label) ?? label }))
    : [];
  const setupRows = hasEnough
    ? rowsFor(tagged, (t) => byHash.get(t.id)?.setup ?? null, 5, (k) => drill(period, { setup: k }))
    : [];
  const tfRows = hasEnough
    ? rowsFor(tagged, (t) => byHash.get(t.id)?.timeframe ?? null, 5, (k) => drill(period, { tf: k }))
    : [];
  const mistakeRows = hasEnough
    ? rowsFor(tagged, (t) => { const m = byHash.get(t.id)?.mistakes ?? []; return m.length ? mistakeLabel(m[0]) : null; }, 5,
        (label) => drill(period, { mistake: mistakeKeys.get(label) ?? label }))
    : [];

  // Calm against charged states. Feelings are grouped rather than listed one by
  // one because any single state has a small sample long before the split does.
  const calm = tagged.filter((t) => { const f = byHash.get(t.id)?.emotion; return f && isGoodFeeling(f); });
  const charged = tagged.filter((t) => { const f = byHash.get(t.id)?.emotion; return f && !isGoodFeeling(f); });
  const calmS = computeStats(calm), chargedS = computeStats(charged);
  const showMindset = calm.length >= 8 && charged.length >= 8;

  /**
   * Counted per exit, and stops split by whether they fired in profit.
   *
   * A stop moved to breakeven after a partial is still reported as "sl" by the
   * broker, so pooling it with real stop-outs hides both: it makes the stop group
   * look survivable and hides how large the genuine losses are.
   */
  const exitGroups = new Map<string, { net: number; n: number; won: number }>();
  for (const e of exits) {
    const pnl = e.profit + e.commission + e.swap;
    const key =
      e.closeReason === "tp" ? "Target was hit"
      : e.closeReason === "so" ? "Margin call"
      : e.closeReason === "sl" ? (pnl >= 0 ? "Stop hit in profit" : "Stop hit at a loss")
      : "You closed it by hand";
    const g = exitGroups.get(key) ?? { net: 0, n: 0, won: 0 };
    g.net += pnl; g.n += 1; if (pnl > 0) g.won += 1;
    exitGroups.set(key, g);
  }
  const endedRows: BarRow[] = [...exitGroups.entries()]
    .filter(([, g]) => g.n >= MIN)
    .sort((a, b) => b[1].net - a[1].net)
    .map(([label, g]) => ({
      label,
      value: Math.round(g.net * 100) / 100,
      meta: `${g.n.toLocaleString()} exits · avg ${money(g.net / g.n)}`,
    }));
  const protectedStops = exitGroups.get("Stop hit in profit");
  const realStops = exitGroups.get("Stop hit at a loss");
  const targets = exitGroups.get("Target was hit");
  const byHand = exitGroups.get("You closed it by hand");

  const stopRows = rowsFor(trades, (t) => (t.hadStop ? "Stop loss set" : "No stop set"), MIN,
    (k) => drill(period, { shape: k === "Stop loss set" ? "stop" : "nostop" }));
  const hourRows = rowsFor(trades, (t) => `${String(hourIn(t.openedAt, timeZone)).padStart(2, "0")}:00`, 15,
    (k) => drill(period, { hour: String(Number(k.slice(0, 2))) })).slice(0, 12);
  const sessionRows = rowsFor(trades, (t) => sessionOf(t.openedAt), MIN,
    (k) => drill(period, { session: k }));
  const dayRows = rowsFor(trades, (t) => weekdayIn(t.openedAt, timeZone), MIN, (k) => drill(period, { day: k }));
  const holdRows = rowsFor(trades, (t) => holdBucket(t.holdMinutes), MIN, (k) => drill(period, { hold: k }));
  const dirRows = rowsFor(trades, (t) => (t.direction === "long" ? "Buys" : "Sells"), MIN,
    (k) => drill(period, { direction: k === "Buys" ? "long" : "short" }));
  const ladderRows = rowsFor(trades, (t) => (t.legCount > 1 ? `Laddered in` : "Single entry"), MIN,
    (k) => drill(period, { shape: k === "Laddered in" ? "laddered" : "single" }));

  // Counterfactuals, reported in BOTH directions. Testing on real data turned up a
  // bucket that intuition called bad and that was in fact carrying profit, so a
  // panel that only lists leaks would quietly mislead (docs/20 §3.4).
  const worstHour = hourRows.length && hourRows[hourRows.length - 1].value < 0
    ? hourRows[hourRows.length - 1] : null;
  const cfHour = worstHour
    ? counterfactual(trades, (t) => `${String(hourIn(t.openedAt, timeZone)).padStart(2, "0")}:00` === worstHour.label)
    : null;
  const cfLong = counterfactual(trades, (t) => t.holdMinutes > 30);

  /*
   * Weekend holds are separated rather than averaged in, because they are not a
   * read on the setup. Nothing about a position held through a closure was
   * decided after entry: it reopens where it reopens. Mixed into "how long do I
   * hold", a handful of them can swamp the hold-time answer entirely.
   */
  /*
   * Mark-up, pooled across every trade that carries it.
   *
   * A zone drawn on one trade is a note. The same zone drawn on fifteen trades
   * over two months is a level the trader keeps returning to, and its combined
   * result is a thing no other screen can show — it lives in the drawings, not
   * in the broker's export. Clustering ignores the names, so a band called demand
   * in March and supply in May shows up as one level that flipped rather than two
   * unrelated ones, which is the case a level trader most wants to see.
   */
  const marks: Mark[] = trades.flatMap((t) =>
    (byHash.get(t.id)?.drawings ?? []).map((d) => ({
      tradeId: t.id, low: d.low, high: d.high, label: d.label, netPnl: t.netPnl, at: t.closedAt,
    })));
  const levels = clusterLevels(marks).filter((l) => l.trades >= 3).slice(0, 8);

  /*
   * Day of the week against time of day.
   *
   * Both already have a chart and neither can say what this says. "Fridays are
   * bad" and "the afternoon is bad" are different claims from "Friday
   * afternoons are bad", and only the third is something anyone can act on.
   * Bucketed to two hours when the trading day is wide, because a cell too
   * small to print its own amount in would leave colour carrying the meaning
   * alone, and green against red is the pair most readers with a colour
   * deficiency cannot separate.
   */
  const distinctHours = new Set(trades.map((t) => hourIn(t.openedAt, timeZone))).size;
  const grid = hourWeekdayGrid(trades, timeZone, distinctHours <= 12 ? 1 : 2);
  const gridCells = grid.cells.map((c) => ({
    row: c.day, col: c.hour, value: c.net, count: c.trades,
    href: drill(period, {
      day: c.day,
      hour: grid.bucketHours === 1 ? String(c.hour) : `${c.hour}-${c.hour + grid.bucketHours - 1}`,
    }),
  }));
  const worstCell = grid.cells.length ? grid.cells.reduce((a, b) => (b.net < a.net ? b : a)) : null;
  const bestCell = grid.cells.length ? grid.cells.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const gridHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

  /*
   * The shape of the results, which every average on this page is blind to.
   * It matters most here of all places: this account is traded without a
   * platform stop, and the only thing that can show what that costs is the left
   * tail — which is exactly what a mean of the losses hides.
   */
  const dist = distribution(trades.map((t) => t.netPnl));

  /*
   * What happens immediately after a loss. Needs nothing written down: tilt is
   * a behaviour, and re-entering faster and larger than usual leaves its marks
   * in the timestamps and volumes the broker already reported.
   */
  const tilt = tiltProfile(trades, timeZone);
  const faster = tilt ? tilt.afterWin.gapMinutes - tilt.afterLoss.gapMinutes : 0;
  const bigger = tilt && tilt.afterWin.lots > 0 ? tilt.afterLoss.lots / tilt.afterWin.lots - 1 : 0;

  const overWeekend = trades.filter((t) => heldOverWeekend(t.openedAt, t.closedAt));
  const weekendStats = computeStats(overWeekend);
  const cfWeekend = overWeekend.length
    ? counterfactual(trades, (t) => heldOverWeekend(t.openedAt, t.closedAt))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs base="/analytics" active={period} />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          from {count(s.n)}, no tagging needed
        </span>
      </div>

      <Card>
        <Eyebrow>How to read these</Eyebrow>
        <Note>
          Every bar is the money you made or lost in that group, with how many trades it
          covers. Groups with fewer than {MIN} trades are left out, because a handful of
          trades cannot tell you anything. <b>Tap any bar</b> to read the trades behind it.
        </Note>
        <Info title="Why a pattern here is not proof">
          These charts show things that happened <i>together</i>. That is not the same as one
          causing the other. A group can look bad because of a single terrible day inside it,
          because those trades were taken in unusual conditions, or by chance.
          <br /><br />
          The way to use them: treat a strong bar as a <b>question</b>, not an answer. Pick
          one, change that single thing deliberately for a few weeks, and see whether the
          number moves. That is the only test that settles it.
        </Info>
      </Card>

      {!hasEnough && (
        <Card>
          <Eyebrow>Locked until you annotate</Eyebrow>
          <Verdict>
            Setups, confluences, your state of mind and R all need input only you have.
            {tagged.length > 0 ? ` You have annotated ${count(tagged.length)} so far — ${ANNOT_MIN} unlocks these.` : " Nothing is annotated yet."}
          </Verdict>
          <Note>
            <a href="/review" className="tap" style={{ color: "var(--c1)", fontWeight: 600 }}>Start with your biggest trades →</a>{" "}
            The queue is sorted by size of result, so twenty annotations there are worth two
            hundred picked at random.
          </Note>
        </Card>
      )}

      {showMindset && (
        <Card>
          <Eyebrow>Your state of mind</Eyebrow>
          <Verdict>
            Trades you took calm came to <b className={calmS.net >= 0 ? "pos" : "neg"}>{money0(calmS.net)}</b> across{" "}
            {count(calmS.n)}. Trades you took rushed, bored, on tilt or chasing came to{" "}
            <b className={chargedS.net >= 0 ? "pos" : "neg"}>{money0(chargedS.net)}</b> across {count(chargedS.n)}.
          </Verdict>
          <BarChart
            rows={[
              { label: "Calm and patient", value: calmS.net, meta: `${count(calmS.n)} · won ${pct(calmS.winRate, 0)}`, flag: true },
              { label: "Rushed or charged", value: chargedS.net, meta: `${count(chargedS.n)} · won ${pct(chargedS.winRate, 0)}`, flag: true },
            ]}
            format={(v) => money0(v)}
          />
          {feelingRows.length >= 2 && (
            <div className="mt-5">
              <div className="text-[12.5px] font-semibold">Broken down by feeling</div>
              <BarChart rows={feelingRows} format={(v) => money0(v)} />
            </div>
          )}
          <Info title="Why this is the most valuable chart here">
            Every other number in this app your broker already knows. This one exists only
            because you wrote it down, and it is usually where the difference between two
            traders with identical strategies actually lives.
            <br /><br />
            One honest caution: you tag how you felt <i>after</i> seeing the result, and memory
            bends toward the outcome. Tag it the same evening, before the number has had time
            to rewrite the feeling.
          </Info>
        </Card>
      )}

      {levels.length > 0 && (
        <Card>
          <Eyebrow>Levels you keep returning to</Eyebrow>
          <Verdict>
            Every zone and level you have drawn, pooled by price. These are the bands you trade
            again and again, and what they have paid you.
          </Verdict>
          <ul className="mt-3 space-y-2">
            {levels.map((l) => {
              const flipped = l.labels.length > 1;
              return (
                <li key={`${l.low}-${l.high}`}>
                  <Link href={drill(period, { level: `${l.low.toFixed(2)}:${l.high.toFixed(2)}` })}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                        style={{ background: "var(--s3)" }}>
                    <span className="h-8 w-1 shrink-0 rounded-full"
                          style={{ background: l.net >= 0 ? "var(--profit)" : "var(--loss)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="num text-[13.5px] font-semibold">
                        {l.low.toFixed(2)} – {l.high.toFixed(2)}
                      </div>
                      <div className="truncate text-[11px]" style={{ color: "var(--ink3)" }}>
                        {l.labels.map((x) => `${x.label}${x.count > 1 ? ` ×${x.count}` : ""}`).join(" · ")}
                        {flipped ? " — you have called this both ways" : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`num text-[13.5px] font-semibold ${l.net >= 0 ? "pos" : "neg"}`}>
                        {money0(l.net)}
                      </div>
                      <div className="num text-[10.5px]" style={{ color: "var(--ink3)" }}>
                        {l.trades} trades · {l.wins}W {l.losses}L
                      </div>
                    </div>
                    <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Info title="Why the names are pooled rather than separated">
            A band you called demand in March and supply in May is one level that flipped, not
            two levels — and a level flipping is the most informative thing that happens to it.
            Splitting them by the name you happened to give them would hide exactly the case
            worth seeing, so they are grouped by price and every name you used is listed.
            <br /><br />
            Levels are matched when they overlap or sit within about five parts in ten thousand
            of each other, which is roughly the width of a line drawn by eye. Only bands you
            have marked on three or more trades appear here.
          </Info>
        </Card>
      )}

      {setupRows.length > 0 && (
        <Card>
          <Eyebrow>Your playbook</Eyebrow>
          <Verdict>
            Each setup has its own page, with what separates the times it works from the times
            it does not.
          </Verdict>
          <Note>
            <Link href={`/playbook?period=${period}`} className="tap" style={{ color: "var(--c1)", fontWeight: 600 }}>
              Open the playbook →
            </Link>
          </Note>
        </Card>
      )}

      <Section
        title="By setup"
        verdict={setupRows.length ? `Across the trades you have tagged, ${setupRows[0].label} is your strongest.` : ""}
        rows={setupRows}
        info="Only counts annotated trades, so it moves as you tag more. Treat a setup as unproven until it has at least thirty trades behind it."
      />

      <Section
        title="By timeframe you read it on"
        verdict="Whether the timeframe you take the setup from changes how it performs."
        rows={tfRows}
        info="If your lower timeframes underperform, you may be reading noise as structure — the same setup on a higher timeframe is effectively a different trade."
      />

      <Section
        title="What your mistakes cost"
        verdict={mistakeRows.length ? `Trades you tagged with a mistake, grouped by the first one tagged.` : ""}
        rows={mistakeRows}
        info="Only trades where you tagged something. This is deliberately self-reported: the point is to make the price of a habit visible to you, not to catch you out."
      />

      {endedRows.length >= 2 && (
        <Card>
          <Eyebrow>How your trades ended</Eyebrow>
          <Verdict>
            {targets && byHand
              ? `Exits that ran to a target averaged ${money(targets.net / targets.n)}. Exits you closed by hand averaged ${money(byHand.net / byHand.n)}.`
              : "This splits every exit by what actually closed it."}
          </Verdict>
          <BarChart rows={endedRows} format={(v) => money0(v)} />
          {protectedStops && realStops && (
            <Note>
              Notice the two stop rows. <b>{protectedStops.n} of your stop exits fired in
              profit</b> — those are stops you had already moved to breakeven or better, doing
              exactly their job. The {realStops.n} that fired at a loss cost{" "}
              <b className="neg">{money0(realStops.net)}</b>, averaging{" "}
              <b>{money(realStops.net / realStops.n)}</b> each, which is far larger than your
              typical trade. Your real stop-outs are rare and heavy.
            </Note>
          )}
          <Info title="Why is this counted in exits rather than trades?">
            How a trade ended is a property of each <i>exit</i>, not of the trade. You ladder
            into a zone, take two partials by hand and let the runner hit the stop — that
            trade had three different endings, and forcing one label onto it would have
            reported a profitable trade as &ldquo;stopped out&rdquo;. Counting exits avoids
            inventing a single answer where there were several.
          </Info>
          <Caveat>
            <b>The target row is not a fair comparison.</b> A target only fills if price
            reached it, so those exits are selected for having gone well. What is fair to say
            is that it is worth testing on purpose: set a target on a run of trades and see
            whether the pattern survives.
          </Caveat>
        </Card>
      )}

      <Section
        title="With and without a stop loss"
        verdict={
          stopRows.length === 2
            ? `Trades with a stop set came to ${money0(stopRows[0].value)}; trades without came to ${money0(stopRows[1].value)}.`
            : ""
        }
        rows={stopRows}
        note={
          <>
            You mostly trade without a platform stop, exiting by judgement instead. This is
            the closest your data can get to asking whether that is working.
          </>
        }
        info={
          <>
            <b>What this means, carefully.</b> The trades where you happened to set a stop may
            simply have been different trades — calmer setups, better conditions, more
            conviction. The stop might be doing the work, or it might just be a marker of the
            trades you were already going to handle well. Nothing here can separate those two.
            <br /><br />
            <b>Why it is still the loudest thing in your data.</b> The gap is large and it sits
            on hundreds of trades. That makes it the single most worthwhile thing to test on
            purpose: set a stop on every trade for a month, and see whether the difference
            follows you.
          </>
        }
      />

      {tilt && (
        <Card>
          <Eyebrow>What you do after a loss</Eyebrow>
          <Verdict>
            {faster > 1 || bigger > 0.1
              ? `After a loss you are back in ${faster > 1 ? `${Math.round(faster)} minutes sooner` : "about as quickly"}${bigger > 0.1 ? ` and ${Math.round(bigger * 100)}% larger` : ""} than after a win.`
              : "After a loss you re-enter at about the same speed and size as after a win — which is the answer you want."}
          </Verdict>

          <div className="mt-4 space-y-3">
            <TiltRow label="Minutes before the next trade"
                     win={tilt.afterWin.gapMinutes} loss={tilt.afterLoss.gapMinutes}
                     big={tilt.afterBigLoss.n ? tilt.afterBigLoss.gapMinutes : null}
                     format={(v) => `${v < 1 ? "<1" : Math.round(v)} min`}
                     worseWhen="lower" />
            <TiltRow label="Size of the next trade"
                     win={tilt.afterWin.lots} loss={tilt.afterLoss.lots}
                     big={tilt.afterBigLoss.n ? tilt.afterBigLoss.lots : null}
                     format={(v) => `${v.toFixed(2)} lots`}
                     worseWhen="higher" />
            <TiltRow label="What the next trade made"
                     win={tilt.afterWin.result} loss={tilt.afterLoss.result}
                     big={tilt.afterBigLoss.n ? tilt.afterBigLoss.result : null}
                     format={(v) => money(v)}
                     worseWhen="lower" />
          </div>

          <Note>
            Measured on {count(tilt.afterLoss.n)} that followed a loss and {count(tilt.afterWin.n)} that
            followed a win
            {tilt.afterBigLoss.n
              ? `, and ${count(tilt.afterBigLoss.n)} that followed a loss worse than ${money0(tilt.bigLossAt)}`
              : ""}.
          </Note>

          <Info title="Why this needs nothing written down">
            Tilt and revenge trading are usually treated as feelings you have to remember and
            tag honestly a week later, which is exactly when memory is least reliable. But they
            are behaviours before they are feelings, and a behaviour leaves marks: re-entering
            faster than usual, with more size than usual, straight after losing money. Both
            halves of that are a timestamp and a volume your broker already reported.
            <br /><br />
            Only trades on the <b>same day</b> are counted. The gap to tomorrow morning measures
            when the market opened, not how you reacted.
          </Info>
          <Caveat>
            A difference here is a habit, not a verdict. The trades after a loss may simply have
            been taken in the conditions that produced the loss — a fast market makes both the
            loss and the quick re-entry. The test that settles it is deliberate: after your next
            loss, stand up for five minutes, and see whether the number moves.
          </Caveat>
        </Card>
      )}

      {dist && (
        <Card>
          <Eyebrow>The size of your results</Eyebrow>
          <Verdict>
            {dist.tailShareOfGross !== null && dist.tailShareOfGross > 0.15
              ? `Your worst ${dist.tailCount} trades cost ${money0(Math.abs(dist.tailTotal))} — ${pct(dist.tailShareOfGross, 0)} of everything your winners made.`
              : `Your typical trade lands at ${money(dist.median)}, and your worst ${dist.tailCount} came to ${money0(dist.tailTotal)}.`}
          </Verdict>
          <Histogram bins={dist.bins} format={(v) => money0(v)} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Typical trade", money(dist.median), undefined],
               ["Average trade", money(dist.mean), "pulled by the tails"],
               [`Worst ${dist.tailCount}`, money0(dist.tailTotal), `each beyond ${money0(dist.tailAt)}`],
               [`Best ${dist.topCount}`, money0(dist.topTotal), undefined]] as const).map(([k, v, sub]) => (
              <div key={k}>
                <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{k}</div>
                <div className="num text-[15px] font-semibold">{v}</div>
                {sub && <div className="text-[10.5px]" style={{ color: "var(--ink3)" }}>{sub}</div>}
              </div>
            ))}
          </div>
          <Info title="Why the shape matters more than the average here">
            The headline number on the Overview — the win rate your payoff ratio needs to break
            even — is built from an <i>average</i> win and an <i>average</i> loss. An average is
            the one statistic that cannot see a tail. Ninety-eight small losses and two
            catastrophic ones average out to something that looks survivable and is not.
            <br /><br />
            That is the question a mental stop raises and nothing else in this app answers: when
            it goes wrong, how wrong does it go. The two outlined bars at the ends collect
            everything past the extremes, so a single enormous trade cannot squash the rest of
            the chart into one column — the outliers are counted, not hidden.
            <br /><br />
            The gap between your typical trade and your average trade is itself the measurement:
            the wider it is, the more of your result lives in a handful of trades.
          </Info>
        </Card>
      )}

      {grid.cells.length >= 6 && grid.days.length >= 2 && (
        <Card>
          <Eyebrow>Day against hour · {zoneName(timeZone)}</Eyebrow>
          <Verdict>
            {worstCell && bestCell && worstCell.net < 0
              ? `${worstCell.day} at ${gridHour(worstCell.hour)} is your worst combination, at ${money0(worstCell.net)} across ${count(worstCell.trades)}.`
              : "Every day of the week against every hour you trade it."}
          </Verdict>
          <Heatmap cells={gridCells} rows={grid.days} cols={grid.hours}
                   colLabel={(h) => (grid.bucketHours === 1 ? gridHour(h) : String(h).padStart(2, "0"))}
                   scale={grid.scale} />
          <Note>
            Tap any square to read the trades in it. Amounts are printed in every square, so the
            colour only helps you find them.
            {grid.hours.length > 6 ? " The grid scrolls sideways for the rest of the day." : ""}
            {" "}Only the hours you actually trade are shown, so the columns may skip.
          </Note>
          <Info title="Why this is worth more than the two charts below it">
            &ldquo;Fridays are bad&rdquo; and &ldquo;the afternoon is bad&rdquo; are different
            claims from &ldquo;Friday afternoons are bad&rdquo;, and only the third is a rule you
            can follow — a single hour on a single weekday is a thing you can simply decide not
            to trade. Averaging either dimension on its own hides the other.
            <br /><br />
            Be careful with the squares holding only a few trades: at this resolution the sample
            in any one cell is small, and one bad afternoon can colour a square dark red. Tap it
            and count before believing it.
          </Info>
        </Card>
      )}

      <Section
        title={`Time of day · ${zoneName(timeZone)}`}
        verdict={`When you opened the trade, in your local time. ${
          hourRows.length && hourRows[hourRows.length - 1].value < 0
            ? `Your worst hour is ${hourRows[hourRows.length - 1].label}, at ${money0(hourRows[hourRows.length - 1].value)}.`
            : ""
        }`}
        rows={hourRows}
        note={
          cfHour && cfHour.improvement > 0 ? (
            <>
              Not trading <b>{worstHour!.label}</b> would have removed {count(cfHour.removedCount)} and
              changed this period from {money0(cfHour.before)} to <b>{money0(cfHour.after)}</b>. Check
              the Overview first — it only flags an hour that loses on most days, not one bad day.
            </>
          ) : undefined
        }
      />

      <Section
        title={`Session · ${zoneName(timeZone)}`}
        verdict="The same picture grouped into trading sessions, which is usually easier to act on than single hours."
        rows={sessionRows}
      />

      <Section title="Day of the week" verdict="Whether some days consistently go better than others." rows={dayRows} />

      <Section
        title="How long you held"
        verdict={`Your typical trade lasts ${s.avgHoldMinutes.toFixed(0)} minutes.`}
        rows={holdRows}
        note={
          cfLong.removedCount >= MIN ? (
            <>
              Your trades held over 30 minutes came to <b>{money0(cfLong.removedNet)}</b> across{" "}
              {count(cfLong.removedCount)}. Dropping them would have{" "}
              {cfLong.improvement > 0 ? "improved" : "worsened"} this period by{" "}
              <b>{money0(Math.abs(cfLong.improvement))}</b> — worth knowing before assuming
              that holding longer is the problem.
            </>
          ) : undefined
        }
      />

      <Section
        title="Buying against selling"
        verdict="A persistent gap here usually means a directional habit rather than an edge."
        rows={dirRows}
      />

      <Section
        title="Laddering into a zone"
        verdict={`${trades.filter((t) => t.legCount > 1).length} of your ${trades.length} trades were built from more than one entry.`}
        rows={ladderRows}
        note="If single entries do better, your extra layers are adding size to trades that were already going wrong."
      />
      {overWeekend.length > 0 && (
        <Card>
          <Eyebrow>Held through a weekend</Eyebrow>
          <Verdict>
            {weekendStats.net < 0
              ? `${count(overWeekend.length)} stayed open while the market was shut, and together they cost ${money0(Math.abs(weekendStats.net))}.`
              : `${count(overWeekend.length)} stayed open while the market was shut, and together they made ${money0(weekendStats.net)}.`}
          </Verdict>
          <div className="mt-3">
            <StatGrid cols={3}>
              <Stat label="Weekend holds" value={String(overWeekend.length)}
                    sub={`${pct(weekendStats.winRate, 0)} won`} />
              <Stat label="Their total" value={money0(weekendStats.net)}
                    tone={weekendStats.net >= 0 ? "pos" : "neg"} />
              <Stat label="Worst one" value={money0(Math.min(...overWeekend.map((t) => t.netPnl)))}
                    tone="neg" />
            </StatGrid>
          </div>
          {cfWeekend && (
            <Note>
              Without them the account would be {money0(cfWeekend.after)} rather than{" "}
              {money0(cfWeekend.before)}.{" "}
              <Link href={drill(period, { result: "weekend" })} className="tap" style={{ color: "var(--c1)", fontWeight: 600 }}>
                Read them →
              </Link>
            </Note>
          )}
          <Info title="Why these are counted apart">
            A position open through a closure is not the trade that was entered. It cannot be
            managed, an invalidation cannot be respected, and it reopens wherever the market
            decided over two days — the first price you can act on may be a long way from the
            last one you saw.
            <br /><br />
            Averaged in with everything else, a handful of them can swamp the answer to a
            question they have nothing to do with, like how long your holds should be. They
            are found from the clock, so nothing needs tagging.
          </Info>
        </Card>
      )}

    </div>
  );
}
